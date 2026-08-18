/**
 * delegation-manifest.ts — WKH-361 W0.
 *
 * Declaración, versionada en git, de QUÉ ENDPOINTS DEBERÍA DELEGAR CADA
 * AMBIENTE hacia `wasiai-a2a`. Existe porque hasta hoy la única forma de
 * contestar "¿este ambiente delega?" era pegarle a mano al endpoint y mirar
 * la forma del error — y eso hizo que un ambiente se diera por alineado
 * cuando no lo estaba.
 *
 * `GET /api/v1/status/delegation` compara este manifiesto contra lo que el
 * runtime realmente está haciendo (`listDelegatedEndpoints()`), y el cron
 * `/api/cron/delegation-drift` convierte la diferencia en una señal
 * observable sin intervención humana.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DOS CAMPOS CON DOS NATURALEZAS DISTINTAS — no confundirlos (CD-9):
 *
 *   `hosts`     es DESCRIPTIVO: qué dominios atiende ese proyecto Vercel. Se
 *               corrige con una medición, dejando la evidencia en el PR. Si el
 *               cron reporta `UNDECLARED_HOST` para un host legítimo, lo que se
 *               agrega es el host acá.
 *
 *   `delegated` es PRESCRIPTIVO: la INTENCIÓN. Sólo cambia por una decisión
 *               explícita de alinear (o desalinear) un ambiente.
 *               ⛔ JAMÁS se ajusta a lo observado en runtime para callar al
 *               cron. Hacerlo convierte el detector de drift en un espejo que
 *               se aplaude a sí mismo, que es exactamente el silencio que esta
 *               HU cierra.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Módulo PURO a propósito: sin `server-only`, sin `@/lib/env`, sin I/O.
 * `DelegatedEndpoint` entra como `import type` — se borra en compilación, así
 * que no arrastra el grafo de `forward-handler.ts` (que sí lee `@/lib/env`).
 */
import type { DelegatedEndpoint } from './forward-handler'

export type DelegationEnvironmentKey = 'wasiai-prod' | 'wasiai-v2'

export interface DelegationEnvironmentDeclaration {
  key: DelegationEnvironmentKey
  vercelProject: string
  /** DESCRIPTIVO — medido. Siempre en minúsculas y sin puerto. */
  hosts: readonly string[]
  /** PRESCRIPTIVO — la intención (CD-9). */
  delegated: readonly DelegatedEndpoint[]
  /** 'YYYY-MM-DD' */
  measuredAt: string
  /** el instrumento con el que se midió `delegated` */
  evidence: string
}

/**
 * `mcp` no está delegado en NINGÚN ambiente: `CLAUDE.md:101` lo prohíbe
 * explícitamente hasta que exista el shape adapter.
 */
export const DELEGATION_MANIFEST: readonly DelegationEnvironmentDeclaration[] = [
  {
    key: 'wasiai-prod',
    vercelProject: 'wasiai-prod',
    // `app.wasiai.io` es por donde entra el tráfico real; `wasiai-prod.vercel.app`
    // va porque `CLAUDE.md:10` lo declara como URL del proyecto.
    hosts: ['app.wasiai.io', 'wasiai-prod.vercel.app'],
    delegated: ['capabilities', 'compose', 'orchestrate'],
    measuredAt: '2026-08-18',
    evidence:
      'POST /api/v1/compose {"steps":[]} ⇒ {"code":"VALIDATION_ERROR","requestId":…} ' +
      '(cuerpo del gateway, no existe en ningún handler de este repo); ' +
      'GET /api/v1/capabilities?limit=1 ⇒ claves registries/sources/catalogStatus/totalAtLeast',
  },
  {
    key: 'wasiai-v2',
    vercelProject: 'wasiai-v2',
    hosts: ['wasiai-v2.vercel.app'],
    // Vacío A PROPÓSITO (DT-2 B+): este ambiente NO se alinea en esta HU.
    // Su 503 en /compose es el comportamiento esperado, no un incidente.
    delegated: [],
    measuredAt: '2026-08-18',
    evidence:
      'POST /api/v1/compose ⇒ 503 {"error":"COMPOSE_DISABLED"}; ' +
      'GET /api/v1/capabilities ⇒ {agents,total,next_cursor} (rama legacy, capabilities/route.ts:369-372)',
  },
]

/**
 * Normaliza un `Host` header: recorta, pasa a minúsculas y saca el puerto.
 * Soporta la forma con corchetes de IPv6 (`[::1]:3000` ⇒ `[::1]`).
 * Devuelve `null` si no queda nada utilizable.
 */
export function normalizeHost(host: string | null): string | null {
  if (host === null) return null
  const trimmed = host.trim().toLowerCase()
  if (trimmed.length === 0) return null

  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']')
    if (close === -1) return trimmed
    return trimmed.slice(0, close + 1)
  }

  const colon = trimmed.indexOf(':')
  const withoutPort = colon === -1 ? trimmed : trimmed.slice(0, colon)
  return withoutPort.length === 0 ? null : withoutPort
}

/**
 * Resuelve la declaración del ambiente a partir del `Host` recibido.
 * Match EXACTO sobre el host normalizado, sin comodines ni sufijos: un host
 * desconocido devuelve `null`, que aguas arriba se traduce en
 * `UNDECLARED_HOST`. Fail-loud, nunca silencio — un comodín `*.vercel.app`
 * haría que cualquier deploy de preview se hiciera pasar por un ambiente
 * declarado, que es la familia de error que abrió esta HU.
 */
export function resolveDeclaration(
  host: string | null,
): DelegationEnvironmentDeclaration | null {
  const normalized = normalizeHost(host)
  if (normalized === null) return null
  return DELEGATION_MANIFEST.find((d) => d.hosts.includes(normalized)) ?? null
}

export interface DelegationDiff {
  /** declarados en el manifiesto que el runtime NO está delegando */
  missing: string[]
  /** delegados en runtime que el manifiesto NO declara */
  unexpected: string[]
}

/**
 * Compara los dos conjuntos COMO CONJUNTOS (CD-16), nunca por igualdad de
 * array: un `DRIFT` disparado por orden de inserción sería una alarma falsa
 * diaria, y una alarma falsa diaria es la forma más rápida de volver a no
 * mirar nada. Las dos salidas van ordenadas alfabéticamente para que el
 * mensaje del cron sea estable entre corridas.
 *
 * Lo consumen tanto `GET /api/v1/status/delegation` (para el veredicto
 * MATCH/DRIFT) como `GET /api/cron/delegation-drift` (para nombrar cada
 * endpoint que difiere): una sola fórmula, dos consumidores.
 */
export function diffDelegation(
  runtime: readonly string[],
  declared: readonly string[],
): DelegationDiff {
  const runtimeSet = new Set(runtime)
  const declaredSet = new Set(declared)
  return {
    missing: [...declaredSet].filter((e) => !runtimeSet.has(e)).sort(),
    unexpected: [...runtimeSet].filter((e) => !declaredSet.has(e)).sort(),
  }
}
