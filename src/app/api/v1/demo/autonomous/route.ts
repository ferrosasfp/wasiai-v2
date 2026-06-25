import { NextRequest, NextResponse } from 'next/server'
import { callLLM } from '@/lib/agents/llm'
import { CollectionAgent, getCollectionAgents, buildPlannerPrompt } from '@/lib/agents/collection-agents'

export const maxDuration = 60

const REPORT_SYSTEM = `You are a DeFi analyst generating an autonomous agent report. Based on the pipeline results below, write a clear analysis (max 300 words) covering: current token price, risk assessment, market signals, and a recommendation. Use plain language. Include exact numbers.`

interface Phase {
  name: 'discovery' | 'planning' | 'execution' | 'report'
  status: 'ok' | 'error'
  detail?: string | undefined
}

export async function POST(req: NextRequest) {
  const phases: Phase[] = []

  // AC7 — auth
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey?.trim()) return NextResponse.json({ error: 'Agent Key required', code: 'missing_key' }, { status: 401 })

  // AC8 — parse + validate goal
  let body: { goal?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'missing_goal' }, { status: 400 }) }
  const goal = body.goal
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    return NextResponse.json({ error: 'goal must be a non-empty string', code: 'missing_goal' }, { status: 400 })
  }

  // --- Phase: discovery ---
  let agents: CollectionAgent[]
  try {
    agents = await getCollectionAgents()
  } catch (err) {
    phases.push({ name: 'discovery', status: 'error', detail: String(err) })
    return NextResponse.json({ error: 'Failed to load agents', code: 'execution_failed', phases }, { status: 500 })
  }

  let steps: unknown[]
  try {
    const plannerSystem = buildPlannerPrompt(agents)
    const plannerRes = await callLLM({ messages: [{ role: 'system', content: plannerSystem }, { role: 'user', content: goal }], temperature: 0, maxTokens: 512, model: 'llama-3.1-8b-instant' })
    const raw = plannerRes.result.trim()
    const match = raw.match(/\[[\s\S]*\]/)
    steps = JSON.parse(match ? match[0] : raw)
    if (!Array.isArray(steps)) throw new Error('not array')
  } catch (err) {
    phases.push({ name: 'discovery', status: 'error', detail: String(err) })
    return NextResponse.json({ error: 'Failed to plan pipeline', code: 'execution_failed', phases }, { status: 500 })
  }
  phases.push({ name: 'discovery', status: 'ok' })

  // --- Phase: planning ---
  if (steps.length === 0) {
    phases.push({ name: 'planning', status: 'error', detail: 'no steps' })
    return NextResponse.json({ error: 'I can only analyze DeFi/crypto topics', code: 'no_agents_matched', phases }, { status: 422 })
  }
  // Normalize (COPY EXACTLY from chat/route.ts step 9)
  const validSlugs = new Set(agents.map(a => a.slug))
  const normalizedSteps = steps.map((s: unknown) => {
    const step = { ...(s as Record<string, unknown>) }
    if (typeof step.input === 'string') { try { step.input = JSON.parse(step.input) } catch { /* leave */ } }
    if (step.pass_output === true && step.input !== undefined) { delete step.input }
    if (!step.agent_slug && step.agent) { step.agent_slug = step.agent; delete step.agent }
    return step
  })
  const filteredSteps = normalizedSteps.filter(s => validSlugs.has((s as Record<string, unknown>).agent_slug as string))
  if (filteredSteps.length === 0) {
    phases.push({ name: 'planning', status: 'error', detail: 'no valid slugs' })
    return NextResponse.json({ error: 'I can only analyze DeFi/crypto topics', code: 'no_agents_matched', phases }, { status: 422 })
  }
  const limitedSteps = filteredSteps.slice(0, 3)
  const agentChain = limitedSteps.map(s => (s as Record<string, unknown>).agent_slug as string).join(' → ')
  phases.push({ name: 'planning', status: 'ok', detail: agentChain })

  // --- Phase: execution ---
  const composeUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/compose`
  let composeResult: unknown
  let composeOk = false
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 50000)
    const composeRes = await fetch(composeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify({ steps: limitedSteps }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    composeResult = await composeRes.json()
    composeOk = composeRes.ok
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

  // --- Phase: report (fail-open) ---
  let report: string
  try {
    const reportRes = await callLLM({ messages: [{ role: 'system', content: REPORT_SYSTEM }, { role: 'user', content: JSON.stringify(composeResult) }], temperature: 0.3, maxTokens: 400, model: 'llama-3.1-8b-instant' })
    report = reportRes.result
    phases.push({ name: 'report', status: 'ok' })
  } catch {
    report = JSON.stringify(composeResult)
    phases.push({ name: 'report', status: 'error', detail: 'LLM unavailable, raw result returned' })
  }

  const r = composeResult as { total_cost_usdc?: string; pipeline_id?: string }
  return NextResponse.json({ report, phases, total_cost_usdc: r.total_cost_usdc ?? '0.000000', pipeline_id: r.pipeline_id ?? '' })
}
