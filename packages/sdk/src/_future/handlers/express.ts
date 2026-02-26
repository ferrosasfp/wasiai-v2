// OUT OF SCOPE — HU futura
// ═══════════════════════════════════════════════════════════════════
// @wasiai/sdk — Express / Fastify Handler
// ═══════════════════════════════════════════════════════════════════
// Usage:
//   app.use('/api/my-agent', createExpressHandler(myAgent))
// ═══════════════════════════════════════════════════════════════════

import type { WasiAgent } from '../agent'
import { verifyX402Payment, build402Response, X402_CORS_HEADERS } from '../x402'

type ExpressReq = {
  headers: Record<string, string | string[] | undefined>
  body: unknown
  url: string
  method: string
}
type ExpressRes = {
  status: (code: number) => ExpressRes
  json: (body: unknown) => void
  set: (headers: Record<string, string>) => ExpressRes
}
type NextFn = (err?: unknown) => void

interface HandlerOptions {
  treasury?: string
  resourceUrl?: string
}

/**
 * Crea un middleware Express para un WasiAgent.
 *
 * @example
 * ```ts
 * import express from 'express'
 * import { createExpressHandler } from '@wasiai/sdk/express'
 * import myAgent from './agent'
 *
 * const app = express()
 * app.use(express.json())
 * app.use('/api/translate', createExpressHandler(myAgent, {
 *   treasury: process.env.WASIAI_TREASURY!,
 *   resourceUrl: 'https://mi-app.com/api/translate',
 * }))
 * ```
 */
export function createExpressHandler(agent: WasiAgent, options: HandlerOptions = {}) {
  const treasury =
    options.treasury ?? process.env.WASIAI_TREASURY ?? ''

  return async function wasiMiddleware(req: ExpressReq, res: ExpressRes, next: NextFn) {
    const resourceUrl =
      options.resourceUrl ?? agent.config.endpointUrl ?? `http://localhost${req.url}`

    try {
      if (req.method === 'GET') {
        res.set({ 'Content-Type': 'application/json', ...X402_CORS_HEADERS })
        return res.status(200).json({
          schema: 'wasiai/agent-spec/v1',
          name: agent.config.name,
          description: agent.config.description,
          category: agent.config.category,
          price_per_call: agent.config.price,
          invoke_url: resourceUrl,
          capabilities: agent.config.capabilities ?? [],
          payment: {
            price: agent.config.price,
            currency: 'USDC',
            chain: 'avalanche',
            protocol: 'x402',
            facilitator: 'https://facilitator.ultravioletadao.xyz',
            treasury,
          },
        })
      }

      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' })
      }

      const headers = req.headers as Record<string, string>
      const payment = await verifyX402Payment(headers, {
        price: agent.config.price,
        treasury,
        resourceUrl,
        agentName: agent.config.name,
      })

      if (payment === null) {
        const { status, headers: h402, body } = build402Response({
          price: agent.config.price,
          treasury,
          resourceUrl,
          agentName: agent.config.name,
        })
        return res.set({ ...h402 }).status(status).json(body)
      }

      if (!payment.verified) {
        return res
          .set(X402_CORS_HEADERS)
          .status(402)
          .json({ error: 'Payment verification failed', reason: payment.error })
      }

      const startMs = Date.now()
      const result = await agent.handler({
        input: (req.body as Record<string, unknown>) ?? {},
        payment: {
          txHash: payment.txHash,
          amount: agent.config.price,
          payer: payment.payer,
        },
      })

      return res.set(X402_CORS_HEADERS).status(200).json({
        output: result.output,
        meta: {
          agent: agent.config.name,
          latency_ms: Date.now() - startMs,
          charged: agent.config.price,
          currency: 'USDC',
          chain: 'avalanche',
          tx_hash: payment.txHash,
          ...result.meta,
        },
      })
    } catch (err) {
      next(err)
    }
  }
}
