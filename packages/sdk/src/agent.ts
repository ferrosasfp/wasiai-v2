// ═══════════════════════════════════════════════════════════════════
// @wasiai/sdk — createAgent()
// ═══════════════════════════════════════════════════════════════════

import type { AgentConfig, AgentHandler } from './types'

export interface WasiAgent<TInput = Record<string, unknown>, TOutput = unknown> {
  config: AgentConfig & { price: number; type: string }
  handler: AgentHandler<TInput, TOutput>
}

/**
 * Define un agente WasiAI.
 *
 * @example
 * ```ts
 * import { createAgent } from '@wasiai/sdk'
 *
 * export default createAgent({
 *   name: 'Mi Traductor',
 *   description: 'Traduce textos ES↔EN con contexto cultural',
 *   category: 'nlp',
 *   price: 0.001,
 *   async run({ input }) {
 *     const translated = await translate(input.text)
 *     return { output: { text: translated } }
 *   }
 * })
 * ```
 */
export function createAgent<TInput = Record<string, unknown>, TOutput = unknown>(
  config: AgentConfig & {
    run: AgentHandler<TInput, TOutput>
  },
): WasiAgent<TInput, TOutput> {
  const { run, ...agentConfig } = config

  return {
    config: {
      marketplaceUrl: 'https://wasiai.vercel.app',
      price: 0.001,
      type: 'agent',
      ...agentConfig,
    },
    handler: run,
  }
}
