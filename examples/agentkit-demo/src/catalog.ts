// Consulta el catálogo de agentes de WasiAI.
// GET /api/v1/agents?slug=<slug>
// Response shape esperado (array):
// [{ id, name, slug, description, price_usdc, invoke_url, status }, ...]

export interface AgentCatalogItem {
  id:         string
  name:       string
  slug:       string
  description: string
  price_usdc: number
  invoke_url: string
  status:     string
}

export async function getCatalogAgent(
  baseUrl: string,
  slug: string
): Promise<AgentCatalogItem> {
  const url = `${baseUrl.trim()}/api/v1/agents?slug=${encodeURIComponent(slug)}`

  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    throw new Error(`Network error fetching catalog: ${String(err)}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Catalog fetch failed [${res.status}]: ${body}`)
  }

  const agents: AgentCatalogItem[] = await res.json()

  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error(`Catalog returned empty or invalid response for slug '${slug}'`)
  }

  const agent = agents.find((a) => a.slug === slug)
  if (!agent) {
    throw new Error(
      `Agent '${slug}' not found in catalog. Available: ${agents.map((a) => a.slug).join(', ')}`
    )
  }

  if (typeof agent.price_usdc !== 'number' || agent.price_usdc < 0) {
    throw new Error(`Agent '${slug}' tiene price_usdc inválido: ${agent.price_usdc}`)
  }

  if (!agent.invoke_url) {
    throw new Error(`Agent '${slug}' has no invoke_url — cannot invoke`)
  }

  if (agent.status !== 'active') {
    throw new Error(`Agent '${slug}' is not active (status: ${agent.status})`)
  }

  return agent
}
