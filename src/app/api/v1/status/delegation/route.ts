/**
 * GET /api/v1/status/delegation — WKH-361 W2 · AC-5, AC-6.
 *
 * Contesta, SIN que nadie tenga que pegarle a mano a `/compose` y adivinar por
 * la forma del error, qué ambiente está respondiendo y qué endpoints está
 * delegando REALMENTE hacia `wasiai-a2a`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * QUÉ EXPONE, Y POR QUÉ NO ES UN SECRETO:
 *   - dos booleanos de PRESENCIA de `WASIAI_A2A_BASE_URL` y
 *     `WASIAI_V2_FORWARD_KEY`. Nunca su valor, nunca su longitud (AC-5 / CD-11);
 *   - los NOMBRES de los headers que el proxy reenvía. Nombres, jamás valores;
 *   - el conjunto de endpoints delegados;
 *   - datos de despliegue que Vercel ya publica por su cuenta.
 *
 * EL `Host` LO ESCRIBE EL CALLER. Es identidad INFORMATIVA, no un borde de
 * autenticación: por eso la respuesta devuelve el host recibido AL LADO de
 * `declaredAs`, de modo que si alguien falsea el `Host` se ve en la misma
 * respuesta. Como acá no hay secretos, falsearlo no habilita nada. No agregar
 * auth a este endpoint: un endpoint de estado que requiere credencial es un
 * endpoint que nadie consulta.
 *
 * `Cache-Control: no-store` NO ES COSMÉTICO: una respuesta de estado cacheada
 * en el borde podría contestar por un despliegue que no es el que atendió —
 * que es literalmente la familia de error que abrió esta HU.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * CD-4: `delegation.runtime` sale de `listDelegatedEndpoints()`, el mismo
 * símbolo que consultan las rutas, y NUNCA de releer `process.env`. Recalcular
 * la fórmula que vigilás es un guard que se aplaude a sí mismo; y además el
 * conjunto delegado se congela en carga de módulo, así que la env en vivo puede
 * decir algo que las rutas no están usando.
 */
import { NextResponse } from 'next/server'
import {
  listDelegatedEndpoints,
  isForwardKeyConfigured,
  isA2aBaseUrlConfigured,
} from '@/lib/proxy/forward-handler'
import { PASSTHROUGH_HEADERS } from '@/lib/proxy/passthrough-headers'
import {
  normalizeHost,
  resolveDeclaration,
  diffDelegation,
} from '@/lib/proxy/delegation-manifest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export type DelegationMatch = 'MATCH' | 'DRIFT' | 'UNDECLARED_HOST'

export async function GET(req: Request): Promise<NextResponse> {
  const rawHost = req.headers.get('host')
  const host = normalizeHost(rawHost)
  const declaration = resolveDeclaration(rawHost)

  const runtimeEndpoints = [...listDelegatedEndpoints()].sort()
  const declared = declaration ? [...declaration.delegated].sort() : null

  let match: DelegationMatch
  if (declared === null) {
    match = 'UNDECLARED_HOST'
  } else {
    const diff = diffDelegation(runtimeEndpoints, declared)
    match = diff.missing.length === 0 && diff.unexpected.length === 0 ? 'MATCH' : 'DRIFT'
  }

  const body = {
    environment: {
      host,
      vercelEnv: process.env.VERCEL_ENV ?? null,
      deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      declaredAs: declaration?.key ?? null,
    },
    delegation: {
      runtime: runtimeEndpoints,
      declared,
      match,
    },
    config: {
      // Presencia, no valor (CD-11).
      WASIAI_A2A_BASE_URL: isA2aBaseUrlConfigured(),
      WASIAI_V2_FORWARD_KEY: isForwardKeyConfigured(),
    },
    passthroughHeaders: [...PASSTHROUGH_HEADERS],
    checkedAt: new Date().toISOString(),
  }

  return NextResponse.json(body, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
