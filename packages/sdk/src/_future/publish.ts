// OUT OF SCOPE — HU futura
// ═══════════════════════════════════════════════════════════════════
// @wasiai/sdk — publishAgent()
// ═══════════════════════════════════════════════════════════════════

import type { AgentConfig, PublishResult } from './types'

/**
 * Publica o actualiza un agente en WasiAI marketplace.
 *
 * @example
 * ```ts
 * import { publishAgent } from '@wasiai/sdk'
 *
 * const result = await publishAgent({
 *   name: 'Mi Traductor',
 *   description: '...',
 *   category: 'nlp',
 *   price: 0.001,
 *   endpointUrl: 'https://mi-app.vercel.app/api/translate',
 * }, {
 *   apiKey: process.env.WASIAI_API_KEY!,
 * })
 *
 * console.log(result.invokeUrl)
 * ```
 */
export async function publishAgent(
  config: AgentConfig & { endpointUrl: string },
  auth: { apiKey: string; marketplaceUrl?: string },
): Promise<PublishResult> {
  const base = auth.marketplaceUrl ?? config.marketplaceUrl ?? 'https://wasiai.vercel.app'

  try {
    const res = await fetch(`${base}/api/models`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.apiKey}`,
      },
      body: JSON.stringify({
        name: config.name,
        description: config.description,
        category: config.category,
        price_per_call: config.price ?? 0.001,
        endpoint_url: config.endpointUrl,
        capabilities: config.capabilities ?? [],
        metadata: {
          published_via: '@wasiai/sdk',
          mcp_tool_name: config.mcpToolName,
          creator_wallet: config.creatorWallet,
          agent_type: config.type ?? 'agent',
        },
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      return { success: false, error: data.error ?? `HTTP ${res.status}` }
    }

    const slug = data.agent?.slug ?? data.model?.slug ?? data.slug
    return {
      success: true,
      slug,
      marketplaceUrl: `${base}/models/${slug}`,
      invokeUrl: `${base}/api/v1/models/${slug}/invoke`,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}
