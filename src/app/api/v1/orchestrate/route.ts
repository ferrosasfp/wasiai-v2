/**
 * POST /api/v1/orchestrate
 *
 * WAS-299: Open orchestrator — receives a natural language goal,
 * discovers relevant agents from the marketplace, plans a pipeline,
 * executes it via /compose, and returns a synthesized report.
 *
 * Replaces /api/v1/demo/autonomous (closed DeFi-only orchestrator).
 * The Demo UI now calls this endpoint.
 *
 * Auth: x-api-key (agent key with sufficient budget)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { callLLM } from '@/lib/agents/llm'

export const maxDuration = 60

// ── Types ────────────────────────────────────────────────────────────────────

interface DiscoveredAgent {
  slug:         string
  name:         string
  description:  string | null
  price_per_call: number
  input_schema: Record<string, unknown> | null
}

interface Phase {
  name:    'discovery' | 'planning' | 'execution' | 'report'
  status:  'ok' | 'error'
  detail?: string
}

// ── Prompts ──────────────────────────────────────────────────────────────────

function buildPlannerPrompt(agents: DiscoveredAgent[]): string {
  const agentList = agents.map(a => {
    const schema = a.input_schema ?? {}
    const props = (schema.properties as Record<string, unknown> | undefined) ?? {}
    const required: string[] = Array.isArray(schema.required) ? schema.required as string[] : []
    const propList = Object.entries(props)
      .map(([k, v]) => {
        const type = ((v as Record<string, unknown>).type as string) ?? 'string'
        return `"${k}": "${type}"${required.includes(k) ? ' (required)' : ' (optional)'}`
      })
      .join(', ')
    return `- ${a.slug}: ${a.description ?? a.name} (input: {${propList}})`
  }).join('\n')

  return `You are WasiAI's pipeline planner. Given a user goal, return a JSON array of ComposeStep objects.

Available agents (ONLY use these — do NOT invent slugs):
${agentList}

Rules:
- Return ONLY a valid JSON array, no explanation, no markdown
- First step MUST have "input" object with ALL required fields extracted from the user goal
- Field names MUST match exactly what the agent expects
- Subsequent steps use "pass_output": true (no "input" field)
- Maximum 3 steps
- If no agent matches the goal, return []
- NEVER include an agent if you cannot provide ALL its required fields

Example for "Analyze AVAX price":
[{"agent_slug":"wasi-chainlink-price","input":{"token":"AVAX"}},{"agent_slug":"wasi-risk-report","pass_output":true}]`
}

const REPORT_SYSTEM = `You are a helpful AI analyst. Based on the pipeline results below, write a clear and concise analysis (max 300 words). Reference exact numbers and data from the results. Use plain language.`

// ── Discovery via Supabase RPC ────────────────────────────────────────────────

async function discoverAgents(goal: string): Promise<DiscoveredAgent[]> {
  // Use service client — orchestrate runs server-side without user session
  const supabase = createServiceClient()
  const { data, error } = await supabase.rpc('discover_agents_v2', {
    p_category:  null,
    p_max_price: null,
    p_limit:     20,
  })
  if (error) throw new Error(`discover_agents_v2: ${error.message}`)

  // Filter: only agents with input_schema (planner needs it to build correct steps)
  const agents: DiscoveredAgent[] = ((data ?? []) as Record<string, unknown>[])
    .filter(a => {
      const schema = a.input_schema as Record<string, unknown> | null
      return schema !== null && typeof schema === 'object' && Object.keys(schema).length > 0
    })
    .map(a => ({
      slug:          a.slug as string,
      name:          a.name as string,
      description:   typeof a.description === 'string' ? a.description : null,
      price_per_call: Number(a.price_per_call ?? 0),
      input_schema:  a.input_schema as Record<string, unknown>,
    }))

  // Hint: if goal mentions DeFi keywords, boost DeFi agents to top
  const defiKeywords = ['token', 'crypto', 'defi', 'wallet', 'price', 'avax', 'eth', 'btc', 'risk', 'chainlink']
  const isDefi = defiKeywords.some(k => goal.toLowerCase().includes(k))
  if (isDefi) {
    agents.sort((a, b) => {
      const aDefi = a.slug.includes('defi') || a.slug.includes('chain') || a.slug.includes('risk') ? -1 : 0
      const bDefi = b.slug.includes('defi') || b.slug.includes('chain') || b.slug.includes('risk') ? -1 : 0
      return aDefi - bDefi
    })
  }

  return agents
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const phases: Phase[] = []

  // Auth
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey?.trim()) {
    return NextResponse.json({ error: 'Agent Key required', code: 'missing_key' }, { status: 401 })
  }

  // Parse body
  let body: { goal?: unknown }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'missing_goal' }, { status: 400 })
  }
  const goal = body.goal
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    return NextResponse.json({ error: 'goal must be a non-empty string', code: 'missing_goal' }, { status: 400 })
  }

  // Phase: discovery
  let agents: DiscoveredAgent[]
  try {
    agents = await discoverAgents(goal)
    if (agents.length === 0) {
      phases.push({ name: 'discovery', status: 'error', detail: 'no agents with input_schema found' })
      return NextResponse.json({ error: 'No agents available', code: 'no_agents_matched', phases }, { status: 422 })
    }
  } catch (err) {
    phases.push({ name: 'discovery', status: 'error', detail: String(err) })
    return NextResponse.json({ error: 'Failed to discover agents', code: 'execution_failed', phases }, { status: 500 })
  }

  // Phase: planning (LLM)
  let steps: unknown[]
  try {
    const plannerSystem = buildPlannerPrompt(agents)
    const plannerRes = await callLLM({
      messages: [
        { role: 'system', content: plannerSystem },
        { role: 'user',   content: goal },
      ],
      temperature: 0,
      maxTokens:   512,
      model:       'llama-3.1-8b-instant',
    })
    const raw   = plannerRes.result.trim()
    const match = raw.match(/\[[\s\S]*\]/)
    steps = JSON.parse(match ? match[0] : raw)
    if (!Array.isArray(steps)) throw new Error('not array')
  } catch (err) {
    // If the LLM returned free text (non-JSON), treat as "no agents matched" — not a server error
    const detail = String(err)
    const isParseError = detail.includes('SyntaxError') || detail.includes('not valid JSON') || detail.includes('not array')
    phases.push({ name: 'planning', status: 'error', detail })
    if (isParseError) {
      return NextResponse.json({ error: 'Could not build a pipeline for this goal', code: 'no_agents_matched', phases }, { status: 422 })
    }
    return NextResponse.json({ error: 'Failed to plan pipeline', code: 'execution_failed', phases }, { status: 500 })
  }

  // Normalize + validate steps
  const validSlugs = new Set(agents.map(a => a.slug))
  const normalizedSteps = steps.map((s: unknown) => {
    const step = { ...(s as Record<string, unknown>) }
    if (typeof step.input === 'string') { try { step.input = JSON.parse(step.input) } catch { /* leave */ } }
    if (step.pass_output === true && step.input !== undefined) { delete step.input }
    if (!step.agent_slug && step.agent) { step.agent_slug = step.agent; delete step.agent }
    return step
  })
  const filteredSteps = normalizedSteps.filter(s =>
    validSlugs.has((s as Record<string, unknown>).agent_slug as string)
  )

  if (filteredSteps.length === 0) {
    phases.push({ name: 'planning', status: 'error', detail: 'no valid agent slugs in plan' })
    return NextResponse.json({ error: 'Could not build a pipeline for this goal', code: 'no_agents_matched', phases }, { status: 422 })
  }

  const limitedSteps = filteredSteps.slice(0, 3)
  const agentChain   = limitedSteps.map(s => (s as Record<string, unknown>).agent_slug as string).join(' → ')
  phases.push({ name: 'planning', status: 'ok', detail: agentChain })

  // Phase: execution via /compose
  const composeUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/compose`
  let composeResult: unknown
  let composeOk = false
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 50_000)
    const composeRes = await fetch(composeUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body:    JSON.stringify({ steps: limitedSteps }),
      signal:  controller.signal,
    })
    clearTimeout(timeout)
    composeResult = await composeRes.json()
    composeOk     = composeRes.ok
  } catch (err) {
    phases.push({ name: 'execution', status: 'error', detail: String(err) })
    return NextResponse.json({ error: 'Pipeline execution failed', code: 'execution_failed', phases }, { status: 502 })
  }

  if (!composeOk) {
    const e = composeResult as { error?: string }
    phases.push({ name: 'execution', status: 'error', detail: e?.error })
    return NextResponse.json({ error: e?.error ?? 'Pipeline execution failed', code: 'execution_failed', phases }, { status: 502 })
  }
  phases.push({ name: 'execution', status: 'ok' })

  // Phase: report synthesis (fail-open)
  let report: string
  try {
    const reportRes = await callLLM({
      messages: [
        { role: 'system', content: REPORT_SYSTEM },
        { role: 'user',   content: JSON.stringify(composeResult) },
      ],
      temperature: 0.3,
      maxTokens:   400,
      model:       'llama-3.1-8b-instant',
    })
    report = reportRes.result
    phases.push({ name: 'report', status: 'ok' })
  } catch {
    report = JSON.stringify(composeResult)
    phases.push({ name: 'report', status: 'error', detail: 'LLM unavailable — raw result returned' })
  }

  const r = composeResult as { total_cost_usdc?: string; pipeline_id?: string }
  return NextResponse.json({
    report,
    phases,
    agents_used:      agentChain,
    total_cost_usdc:  r.total_cost_usdc  ?? '0.000000',
    pipeline_id:      r.pipeline_id      ?? '',
  })
}
