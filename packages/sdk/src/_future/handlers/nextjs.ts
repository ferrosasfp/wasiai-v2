// OUT OF SCOPE — HU futura
// ═══════════════════════════════════════════════════════════════════
// @wasiai/sdk — Next.js Handler
// ═══════════════════════════════════════════════════════════════════
// Usage:
//   // app/api/my-agent/route.ts
//   import myAgent from './agent'
//   export const { POST, GET } = createNextHandler(myAgent)
// ═══════════════════════════════════════════════════════════════════

import type { WasiAgent } from '../agent'
import { verifyX402Payment, build402Response, X402_CORS_HEADERS } from '../x402'

interface HandlerOptions {
  /**
   * Wallet treasury donde llegan los pagos x402.
   * Si no se pasa, se lee de la env var WASIAI_TREASURY o NEXT_PUBLIC_WASIAI_TREASURY.
   */
  treasury?: string

  /**
   * URL base del marketplace para construir resourceUrl.
   * Si no se pasa, se lee de NEXT_PUBLIC_APP_URL o VERCEL_URL.
   */
  appUrl?: string
}

/**
 * Convierte un WasiAgent en route handlers de Next.js App Router.
 *
 * Maneja automáticamente:
 *  - Respuesta 402 cuando no hay payment header
 *  - Verificación x402 con Ultravioleta DAO
 *  - CORS headers
 *  - Respuesta estándar WasiAI
 *  - Spec machine-readable en GET
 *
 * @example
 * ```ts
 * // app/api/my-agent/route.ts
 * import { createNextHandler } from '@wasiai/sdk/nextjs'
 * import agent from './agent'
 *
 * export const { POST, GET } = createNextHandler(agent, {
 *   treasury: process.env.WASIAI_TREASURY!,
 * })
 * ```
 */
export function createNextHandler(
  agent: WasiAgent,
  options: HandlerOptions = {},
) {
  const treasury =
    options.treasury ??
    process.env.WASIAI_TREASURY ??
    process.env.NEXT_PUBLIC_WASIAI_TREASURY ??
    ''

  const getResourceUrl = (req: Request) => {
    const appUrl =
      options.appUrl ??
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
      new URL(req.url).origin

    // Usa la URL configurada en el agente, o construye desde el request
    return agent.config.endpointUrl ?? new URL(req.url).toString()
  }

  // ── POST: procesar llamada al agente ──────────────────────────────────────
  async function POST(req: Request) {
    if (!treasury) {
      console.error('[WasiAI SDK] WASIAI_TREASURY no configurado — los pagos no funcionarán')
    }

    const resourceUrl = getResourceUrl(req)
    const headers = Object.fromEntries(req.headers.entries())

    // 1. Verificar pago x402
    const payment = await verifyX402Payment(headers, {
      price: agent.config.price,
      treasury,
      resourceUrl,
      agentName: agent.config.name,
    })

    // 2. Sin payment header → responder 402 con instrucciones
    if (payment === null) {
      const { status, headers: h402, body } = build402Response({
        price: agent.config.price,
        treasury,
        resourceUrl,
        agentName: agent.config.name,
      })

      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...h402 },
      })
    }

    // 3. Payment inválido
    if (!payment.verified) {
      return new Response(
        JSON.stringify({ error: 'Payment verification failed', reason: payment.error }),
        {
          status: 402,
          headers: { 'Content-Type': 'application/json', ...X402_CORS_HEADERS },
        },
      )
    }

    // 4. Pago válido → ejecutar handler del builder
    let input: Record<string, unknown> = {}
    try {
      input = await req.json()
    } catch {
      /* body vacío está ok */
    }

    const startMs = Date.now()

    try {
      const result = await agent.handler({
        input,
        payment: {
          txHash: payment.txHash,
          amount: agent.config.price,
          payer: payment.payer,
        },
      })

      return new Response(
        JSON.stringify({
          output: result.output,
          meta: {
            agent: slugify(agent.config.name),
            latency_ms: Date.now() - startMs,
            charged: agent.config.price,
            currency: 'USDC',
            chain: 'avalanche',
            tx_hash: payment.txHash,
            ...result.meta,
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...X402_CORS_HEADERS },
        },
      )
    } catch (err) {
      console.error('[WasiAI SDK] Handler error:', err)
      return new Response(
        JSON.stringify({
          error: 'Agent execution failed',
          detail: err instanceof Error ? err.message : String(err),
        }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...X402_CORS_HEADERS },
        },
      )
    }
  }

  // ── GET: spec machine-readable ────────────────────────────────────────────
  async function GET(req: Request) {
    const resourceUrl = getResourceUrl(req)

    return new Response(
      JSON.stringify({
        schema: 'wasiai/agent-spec/v1',
        name: agent.config.name,
        description: agent.config.description,
        category: agent.config.category,
        type: agent.config.type,
        price_per_call: agent.config.price,
        currency: 'USDC',
        chain: 'avalanche',
        chain_id: 43114,
        capabilities: agent.config.capabilities ?? [],
        invoke_url: resourceUrl,
        payment: {
          price: agent.config.price,
          currency: 'USDC',
          chain: 'avalanche',
          chain_id: 43114,
          protocol: 'x402',
          facilitator: 'https://facilitator.ultravioletadao.xyz',
          treasury,
        },
        mcp: agent.config.mcpToolName
          ? {
              tool_name: agent.config.mcpToolName,
              description: agent.config.description,
            }
          : undefined,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...X402_CORS_HEADERS },
      },
    )
  }

  // ── OPTIONS: preflight CORS ───────────────────────────────────────────────
  function OPTIONS() {
    return new Response(null, { status: 204, headers: X402_CORS_HEADERS })
  }

  return { POST, GET, OPTIONS }
}

function slugify(name: string) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}
