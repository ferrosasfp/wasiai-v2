import { createServiceClient } from '@/lib/supabase/server'

// --- Types ---
export interface CollectionAgent {
  slug: string
  name: string
  description: string | null
  status: string
  input_schema: Record<string, unknown> | null
}

// --- Module-level cache ---
let cachedAgents: CollectionAgent[] | null = null
let cacheExpiresAt = 0
const CACHE_TTL_MS = 60_000 // 60 seconds (per SDD #092 AC7)

// --- Schema validation ---
function extractAgent(row: unknown): CollectionAgent | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const a = Array.isArray(r.agents) ? r.agents[0] : r.agents
  if (!a || typeof a !== 'object') return null
  const ag = a as Record<string, unknown>
  if (typeof ag.slug !== 'string' || typeof ag.name !== 'string') return null
  // F1+F2: status guard
  if (ag.status !== 'active') return null
  // F2: input_schema guard — omitir si null o sin propiedades
  const schema = ag.input_schema
  const hasSchema = schema !== null && typeof schema === 'object' && !Array.isArray(schema) && Object.keys(schema as object).length > 0
  if (!hasSchema) return null
  return {
    slug: ag.slug,
    name: ag.name,
    description: typeof ag.description === 'string' ? ag.description : null,
    status: ag.status as string,
    input_schema: schema as Record<string, unknown>,
  }
}

// --- Fetch agents from defi-chat collection ---
export async function getCollectionAgents(): Promise<CollectionAgent[]> {
  const now = Date.now()
  if (cachedAgents && now < cacheExpiresAt) return cachedAgents

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('collection_agents')
    .select('agents(slug, name, description, status, input_schema), collections!inner(slug)')
    .eq('collections.slug', 'defi-chat')
    .eq('agents.status', 'active')
    .order('sort_order')

  if (error) throw new Error(`getCollectionAgents: ${error.message}`)

  const agents: CollectionAgent[] = (data ?? [])
    .map(extractAgent)
    .filter((a): a is CollectionAgent => a !== null)

  cachedAgents = agents
  cacheExpiresAt = now + CACHE_TTL_MS
  return agents
}

// --- Build dynamic planner prompt ---
export function buildPlannerPrompt(agents: CollectionAgent[]): string {
  const agentList = agents.map(a => {
    const schema = a.input_schema ?? {}
    const props = (schema.properties as Record<string, unknown> | undefined) ?? {}
    const required: string[] = Array.isArray(schema.required) ? schema.required as string[] : []
    const propList = Object.entries(props)
      .map(([k, v]) => {
        const type = ((v as Record<string, unknown>).type as string) ?? 'string'
        const isRequired = required.includes(k)
        return `"${k}": "${type}"${isRequired ? ' (required)' : ' (optional)'}`
      })
      .join(', ')
    return `- ${a.slug}: ${a.description ?? a.name} (input: {${propList}})`
  }).join('\n')

  return `You are WasiAI's pipeline planner. Given a user question about DeFi/crypto, return a JSON array of ComposeStep objects.

Available agents (ONLY use these):
${agentList}

Rules:
- Return ONLY a valid JSON array, no explanation, no markdown
- First step MUST have "input" object with ALL required fields extracted from the user question
- The field name MUST match exactly what the agent expects (e.g. "token" not "symbol" or "name")
- Subsequent steps use "pass_output": true (no "input" field)
- Maximum 3 steps
- If the question is not about DeFi/crypto, return []
- NEVER include an agent if you cannot provide ALL its required fields
- Prefer wasi-defi-sentiment over wasi-onchain-analyzer for general analysis/safety/risk questions
- Use wasi-onchain-analyzer ONLY when the user explicitly asks about wallets, transactions, or on-chain activity

CRITICAL: For any agent that requires "token", extract the token symbol from the user question (e.g. "AVAX", "BTC", "ETH"). Always use the ticker symbol, not the full name.

Example for "Analyze AVAX risk":
[{"agent_slug":"wasi-chainlink-price","input":{"token":"AVAX"}},{"agent_slug":"wasi-risk-report","pass_output":true}]

Example for "Is AVAX safe?":
[{"agent_slug":"wasi-defi-sentiment","input":{"token":"AVAX"}}]`
}
