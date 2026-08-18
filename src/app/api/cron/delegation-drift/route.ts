/**
 * GET /api/cron/delegation-drift — WKH-361 W2 · AC-7, AC-11.
 *
 * El mecanismo que hoy no existe: enterarse SOLO de que un ambiente dejó de
 * delegar lo que dice delegar, o de que `wasiai-a2a` estrenó un header que el
 * proxy no reenvía. Sin esto, la única forma de detectar cualquiera de las dos
 * cosas es que alguien vaya a pegarle a mano — que es exactamente por qué el
 * defecto de `x-payment-chain` estuvo meses en el camino del dinero sin que
 * nadie lo viera.
 *
 * DOS COMPARACIONES INDEPENDIENTES:
 *   1. `listDelegatedEndpoints()` (runtime) vs el manifiesto versionado
 *      ⇒ `DELEGATION_DRIFT` (con `missing[]`/`unexpected[]`) o `UNDECLARED_HOST`.
 *   2. los nombres de header que el Agent Card declara vs `PASSTHROUGH_HEADERS`
 *      ⇒ `HEADER_WHITELIST_DRIFT` (con `missing[]`).
 *
 * ⛔ CD-10 — CARD INALCANZABLE NO ES DIVERGENCIA. Si el card no se puede
 * obtener, no trae bloque `contracting`, o trae los campos no-string, el
 * veredicto es `WARN` y el status sigue siendo 200. Apagar el gateway no puede
 * fabricar una alarma de lista blanca: una alarma que se dispara cuando el
 * upstream se cae es una alarma que se aprende a ignorar.
 *
 * TRES CANALES DE SEÑAL, en orden de confiabilidad (DT-6):
 *   1. EL 500 — canal primario. No depende de NINGUNA env var.
 *   2. `logger.error` estructurado.
 *   3. `Sentry.captureMessage`, best-effort.
 *
 * COBERTURA REAL DEL CARD-DIFF, sin adornar (DT-7): sólo caza los headers que
 * `wasiai-a2a` DECLARA en su card (hoy 2: `chainHeader` y `depthHeader`).
 * `x-payment-chain` —el header que costaba plata— NO está declarado en el card,
 * así que este mecanismo NO lo habría cazado. Ese tercer caso (un header que el
 * gateway estrene y no declare) queda DESCUBIERTO y se cierra en A-3, fuera de
 * scope. Lo que sí lo cubre es el criterio escrito de `passthrough-headers.ts`
 * más el test T-04b.
 */
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { verifyCronAuth } from '@/lib/cron/verifyCronSecret'
import { listDelegatedEndpoints } from '@/lib/proxy/forward-handler'
import { PASSTHROUGH_HEADERS } from '@/lib/proxy/passthrough-headers'
import {
  normalizeHost,
  resolveDeclaration,
  diffDelegation,
} from '@/lib/proxy/delegation-manifest'

export const runtime = 'nodejs'

const AGENT_CARD_TIMEOUT_MS = 10_000

export type DelegationVerdict = 'MATCH' | 'DELEGATION_DRIFT' | 'UNDECLARED_HOST'
export type HeaderVerdict = 'MATCH' | 'HEADER_WHITELIST_DRIFT' | 'WARN'

interface AgentCardHeaders {
  reachable: boolean
  headers: string[]
  /** por qué no se pudo leer, cuando `reachable` es false */
  reason: string | null
}

/**
 * Lee los nombres de header que el Agent Card declara. Extrae SÓLO
 * `contracting.chainHeader` y `contracting.depthHeader`, y sólo si son strings;
 * todo lo demás del card se ignora a propósito (no queremos que un campo nuevo
 * cualquiera del upstream se interprete como un header).
 *
 * NUNCA lanza: cualquier problema se devuelve como `reachable: false`, que
 * aguas arriba se traduce en `WARN` y no en drift (CD-10).
 */
export async function fetchAgentCardHeaders(baseUrl: string | undefined): Promise<AgentCardHeaders> {
  if (!baseUrl || baseUrl.length === 0) {
    return { reachable: false, headers: [], reason: 'WASIAI_A2A_BASE_URL not configured' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AGENT_CARD_TIMEOUT_MS)
  try {
    const res = await fetch(`${baseUrl}/.well-known/agent.json`, {
      signal: controller.signal,
    })
    if (!res.ok) {
      return { reachable: false, headers: [], reason: `agent card HTTP ${res.status}` }
    }
    const card: unknown = await res.json()
    const contracting =
      card && typeof card === 'object' && 'contracting' in card
        ? (card as { contracting: unknown }).contracting
        : undefined
    if (!contracting || typeof contracting !== 'object') {
      return { reachable: false, headers: [], reason: 'agent card has no `contracting` block' }
    }

    const block = contracting as Record<string, unknown>
    const names: string[] = []
    for (const field of ['chainHeader', 'depthHeader']) {
      const value = block[field]
      if (typeof value === 'string' && value.trim().length > 0) {
        names.push(value.trim().toLowerCase())
      }
    }
    if (names.length === 0) {
      return {
        reachable: false,
        headers: [],
        reason: 'agent card `contracting` declares no string header names',
      }
    }
    return { reachable: true, headers: names, reason: null }
  } catch (err) {
    return { reachable: false, headers: [], reason: `agent card unreachable: ${String(err)}` }
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = verifyCronAuth(req.headers.get('authorization'))
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const rawHost = req.headers.get('host')
  const host = normalizeHost(rawHost)
  const declaration = resolveDeclaration(rawHost)

  // ── Comparación 1: delegación observada vs declarada (AC-7) ────────────────
  const runtimeEndpoints = [...listDelegatedEndpoints()].sort()
  let delegationVerdict: DelegationVerdict
  let missingEndpoints: string[] = []
  let unexpectedEndpoints: string[] = []

  if (declaration === null) {
    // Fail-loud: un host que nadie declaró no puede validarse contra nada.
    delegationVerdict = 'UNDECLARED_HOST'
  } else {
    const diff = diffDelegation(runtimeEndpoints, declaration.delegated)
    missingEndpoints = diff.missing
    unexpectedEndpoints = diff.unexpected
    delegationVerdict =
      diff.missing.length === 0 && diff.unexpected.length === 0
        ? 'MATCH'
        : 'DELEGATION_DRIFT'
  }

  // ── Comparación 2: headers del Agent Card vs la lista blanca (AC-11) ───────
  const card = await fetchAgentCardHeaders(env.WASIAI_A2A_BASE_URL)
  const whitelist = new Set(PASSTHROUGH_HEADERS)
  const missingHeaders = card.reachable
    ? card.headers.filter((h) => !whitelist.has(h)).sort()
    : []
  const headerVerdict: HeaderVerdict = !card.reachable
    ? 'WARN'
    : missingHeaders.length === 0
      ? 'MATCH'
      : 'HEADER_WHITELIST_DRIFT'

  const drift =
    delegationVerdict !== 'MATCH' || headerVerdict === 'HEADER_WHITELIST_DRIFT'

  const body = {
    environment: {
      host,
      declaredAs: declaration?.key ?? null,
      vercelProject: declaration?.vercelProject ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
    },
    delegation: {
      verdict: delegationVerdict,
      runtime: runtimeEndpoints,
      declared: declaration ? [...declaration.delegated].sort() : null,
      missing: missingEndpoints,
      unexpected: unexpectedEndpoints,
    },
    agentCard: {
      verdict: headerVerdict,
      reachable: card.reachable,
      declaredHeaders: card.headers,
      missing: missingHeaders,
      reason: card.reason,
    },
    checkedAt: new Date().toISOString(),
  }

  if (drift) {
    // Canal 2: log estructurado. Nombra el ambiente y CADA endpoint/header que
    // difiere — un mensaje que sólo dice "hay drift" obliga a ir a mirar, y ese
    // viaje es justamente lo que nadie hace.
    logger.error('[delegation-drift] divergencia detectada', body)
    // Canal 3: best-effort. `sentry.server.config.ts:3` sólo inicializa Sentry
    // si existe `process.env.SENTRY_DSN`, así que SIN DSN esto es un NO-OP
    // SILENCIOSO. Por eso nunca puede ser el canal primario: reintroduciría el
    // silencio que esta HU cierra. El canal primario es el 500 de abajo, que no
    // depende de ninguna env var.
    try {
      Sentry.captureMessage('[delegation-drift] divergencia detectada', {
        level: 'error',
        extra: body,
      })
    } catch {
      // Sentry jamás puede tumbar la señal principal.
    }
    return NextResponse.json(body, { status: 500 })
  }

  if (headerVerdict === 'WARN') {
    // CD-10: el gateway caído se informa, no se disfraza de divergencia.
    logger.warn('[delegation-drift] agent card no disponible', {
      host,
      reason: card.reason,
    })
  }

  return NextResponse.json(body, { status: 200 })
}
