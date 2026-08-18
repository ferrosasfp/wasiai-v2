/**
 * forward-handler.ts — Thin proxy helper para WKH-66.
 *
 * Forwarding HTTP de Next.js App Router (v2) a wasiai-a2a (Fastify, Railway).
 * Header passthrough whitelist + key injection + AbortController timeout +
 * mapeo de error codes (5xx → 502, timeout → 504, 402 passthrough intacto).
 *
 * Feature flag granular `V2_DELEGATE_TO_A2A` (comma-separated).
 */
import { NextRequest, NextResponse } from 'next/server'
import { env } from '@/lib/env'
import { PASSTHROUGH_HEADERS } from './passthrough-headers'

const DEFAULT_TIMEOUT_MS = 180_000

/**
 * TD-LIGHT WKH-65/66 (AR MNR-3): runtime guard.
 * Si algún endpoint está delegado pero la forward key no está configurada,
 * fail-fast con error claro en vez de mandar al upstream un header vacío
 * que el middleware de a2a rechazaría con un 401 críptico.
 *
 * Build-phase escape hatch: durante `next build`, env.WASIAI_V2_FORWARD_KEY
 * puede ser undefined porque createEnvSafe() omite validación strict cuando
 * NEXT_PHASE === 'phase-production-build' (ver src/lib/env.ts:103-115).
 * Esto es intencional para que static page generation no rompa el deploy.
 * El runtime guard de abajo asegura que el primer request post-deploy falle
 * de forma explícita si la env var nunca se inyectó.
 */
/**
 * WKH-361 (CD-4): UN SOLO PREDICADO, DOS CONSUMIDORES.
 * Es la misma expresión que usaba `assertForwardKeyConfigured` inline. Vive
 * suelta para que `GET /api/v1/status/delegation` no pueda contestar `true`
 * donde el proxy tiraría: si el endpoint de estado recalculara la condición
 * por su cuenta, sería un guard que se compara consigo mismo.
 * Devuelve PRESENCIA. Jamás el valor ni su longitud (CD-11).
 */
export function isForwardKeyConfigured(): boolean {
  const key = env.WASIAI_V2_FORWARD_KEY
  return !(!key || key.length === 0)
}

/**
 * WKH-361 (CD-4): mismo criterio de presencia sobre `WASIAI_A2A_BASE_URL`.
 * Existe para que la ruta de estado no lea `env` por su cuenta para uno de los
 * dos booleanos y termine reportando algo distinto de lo que usa el proxy.
 */
export function isA2aBaseUrlConfigured(): boolean {
  const url = env.WASIAI_A2A_BASE_URL
  return !(!url || url.length === 0)
}

function assertForwardKeyConfigured(): string {
  const key = env.WASIAI_V2_FORWARD_KEY
  // `key === undefined` es SÓLO estrechamiento de tipo para el `return` de
  // abajo (la var es `.optional()` en el schema). La condición que decide es
  // `isForwardKeyConfigured()`, la misma que consume el endpoint de estado.
  if (!isForwardKeyConfigured() || key === undefined) {
    throw new Error(
      'WASIAI_V2_FORWARD_KEY is not configured but V2_DELEGATE_TO_A2A includes a delegated endpoint. ' +
        'Set WASIAI_V2_FORWARD_KEY (>=16 chars, must match a2a side) before enabling delegation.',
    )
  }
  return key
}

export type DelegatedEndpoint = 'compose' | 'orchestrate' | 'capabilities' | 'mcp'

/**
 * WKH-361: unión exhaustiva. El `Record<DelegatedEndpoint, true>` obliga a que
 * agregar un miembro a la unión no compile hasta clasificarlo acá — que es
 * exactamente el punto. Sin esto, `DELEGATED_ENDPOINT_VALUES` se quedaría
 * atrás en silencio y `listDelegatedEndpoints()` reportaría un conjunto
 * incompleto al endpoint de estado y al cron.
 * Patrón tomado de `wasiai-a2a/src/adapters/chain-resolver.ts:118-127`.
 */
const DELEGATED_ENDPOINT_ORDER: Record<DelegatedEndpoint, true> = {
  compose: true,
  orchestrate: true,
  capabilities: true,
  mcp: true,
}

export const DELEGATED_ENDPOINT_VALUES = Object.keys(
  DELEGATED_ENDPOINT_ORDER,
) as DelegatedEndpoint[]

export function parseDelegatedEndpoints(raw: string | undefined): Set<string> {
  if (!raw || !raw.trim()) return new Set()
  return new Set(
    raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  )
}

const DELEGATED: Set<string> = parseDelegatedEndpoints(env.V2_DELEGATE_TO_A2A)

export function isDelegated(endpoint: DelegatedEndpoint): boolean {
  return DELEGATED.has(endpoint)
}

/**
 * WKH-361 (CD-4): el conjunto de endpoints que este despliegue está delegando
 * REALMENTE, derivado del mismo `isDelegated` que consultan las rutas.
 *
 * El endpoint de estado y el cron de drift consumen ESTA función y no
 * `process.env`, por dos razones:
 *   (a) recalcular la fórmula que vigilás es un guard que se aplaude solo;
 *   (b) `DELEGATED` se congela en carga de módulo (ver la línea de arriba), así
 *       que leer la env en vivo puede reportar un valor que las rutas no están
 *       usando — sobre lambdas tibias eso es un reporte falso.
 *
 * `DELEGATED` NO se exporta: un `Set` exportado es mutable desde afuera.
 */
export function listDelegatedEndpoints(): DelegatedEndpoint[] {
  return DELEGATED_ENDPOINT_VALUES.filter(isDelegated)
}

export interface ForwardOptions {
  timeoutMs?: number
}

export async function forwardRequest(
  req: NextRequest,
  upstreamUrl: string,
  opts?: ForwardOptions,
): Promise<NextResponse> {
  // AR MNR-3: fail-fast si la forward key no fue inyectada en runtime.
  const forwardKey = assertForwardKeyConfigured()
  const forwardHeaders: Record<string, string> = {
    'x-wasiai-forward-key': forwardKey,
    'x-wasiai-source': 'v2-proxy',
  }
  // NextRequest.headers.get() es case-insensitive (subyace fetch Headers spec),
  // por lo que la whitelist en lowercase matchea cualquier casing del cliente.
  for (const h of PASSTHROUGH_HEADERS) {
    const v = req.headers.get(h)
    if (v) forwardHeaders[h] = v
  }

  const isGet = req.method === 'GET' || req.method === 'HEAD'
  const body = isGet ? undefined : await req.text()

  const finalUrl = isGet
    ? appendSearchParams(upstreamUrl, req.nextUrl.searchParams)
    : upstreamUrl

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const upstream = await fetch(finalUrl, {
      method: req.method,
      headers: forwardHeaders,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
      redirect: 'manual',
    })

    const respText = await upstream.text()
    const respCt = upstream.headers.get('content-type') ?? 'application/json'

    if (upstream.status === 402) {
      return new NextResponse(respText, {
        status: 402,
        headers: { 'content-type': respCt },
      })
    }
    if (upstream.status >= 500) {
      let detail = 'upstream error'
      try {
        const j = JSON.parse(respText) as { error?: string }
        detail = j.error ?? respText.slice(0, 200)
      } catch {
        detail = respText.slice(0, 200)
      }
      return NextResponse.json(
        { error: 'UPSTREAM_ERROR', detail },
        { status: 502 },
      )
    }
    return new NextResponse(respText, {
      status: upstream.status,
      headers: { 'content-type': respCt },
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'GATEWAY_TIMEOUT' },
        { status: 504 },
      )
    }
    // AR MNR-4: no exponer stack traces / mensajes internos al cliente en prod.
    // El detalle completo se loggea para Vercel logs; el body devuelto es genérico.
    console.error('[forward-handler] upstream connection failed:', err)
    const detail =
      env.NODE_ENV === 'production'
        ? 'upstream connection failed'
        : String(err)
    return NextResponse.json(
      { error: 'UPSTREAM_ERROR', detail },
      { status: 502 },
    )
  } finally {
    clearTimeout(timer) // CD-8 inviolable
  }
}

function appendSearchParams(url: string, sp: URLSearchParams): string {
  const u = new URL(url)
  sp.forEach((v, k) => u.searchParams.set(k, v))
  return u.toString()
}
