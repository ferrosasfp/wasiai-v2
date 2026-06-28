import { NextRequest, NextResponse } from 'next/server'
import { callLLM } from '@/lib/agents/llm'
import { CollectionAgent, getCollectionAgents, buildPlannerPrompt } from '@/lib/agents/collection-agents'
import { logger } from '@/lib/logger'

export const maxDuration = 60

const SUMMARY_SYSTEM = `You are a DeFi analyst. Summarize the following agent pipeline results in 2-3 clear sentences for a non-technical user. Always include the exact token price in USD if available (e.g. "AVAX is currently $9.49"). Include key numbers (prices, scores, risk ratings, liquidity). Be concise.`

export async function POST(req: NextRequest) {
  // 1. Validate API key
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Agent Key required', code: 'missing_key' },
      { status: 401 }
    )
  }

  // 2. Parse body
  let body: { question?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'compose_failed' }, { status: 400 })
  }

  const question = body.question
  if (typeof question !== 'string' || question.trim().length === 0 || question.length > 500) {
    return NextResponse.json(
      { error: 'question must be a non-empty string (max 500 chars)', code: 'compose_failed' },
      { status: 400 }
    )
  }

  // 3. Get collection agents
  let agents: CollectionAgent[]
  try {
    agents = await getCollectionAgents()
  } catch (err) {
    logger.error('[chat] getCollectionAgents error', { err })
    return NextResponse.json(
      { error: 'Chat service temporarily unavailable', code: 'chat_unavailable' },
      { status: 503 }
    )
  }

  // 4. If no agents, 503
  if (agents.length === 0) {
    return NextResponse.json(
      { error: 'Chat service temporarily unavailable', code: 'chat_unavailable' },
      { status: 503 }
    )
  }

  // 5. Build dynamic planner prompt
  const plannerSystemPrompt = buildPlannerPrompt(agents)

  // 6. Call LLM planner
  let plannerResponse
  try {
    plannerResponse = await callLLM({
      messages: [
        { role: 'system', content: plannerSystemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0,
      maxTokens: 512,
    })
  } catch (err) {
    logger.error('[chat] planner LLM error', { err })
    return NextResponse.json(
      { error: 'Failed to interpret question', code: 'compose_failed' },
      { status: 500 }
    )
  }

  // 7. Parse LLM output → steps[]
  let steps: unknown[]
  try {
    const raw = plannerResponse.result.trim()
    const match = raw.match(/\[[\s\S]*\]/)
    steps = JSON.parse(match ? match[0] : raw)
    if (!Array.isArray(steps)) throw new Error('Not an array')
  } catch {
    return NextResponse.json(
      {
        error: 'I can only answer questions about DeFi and crypto on Avalanche.',
        code: 'no_agents_matched',
      },
      { status: 422 }
    )
  }

  // 8. If steps.length === 0 → 422
  if (steps.length === 0) {
    return NextResponse.json(
      {
        error: 'I can only answer questions about DeFi and crypto on Avalanche.',
        code: 'no_agents_matched',
      },
      { status: 422 }
    )
  }

  // 9. Normalize steps: fix LLM quirks
  const normalizedSteps = steps.map((s: unknown) => {
    const step = { ...(s as Record<string, unknown>) }
    // If input is string → JSON.parse
    if (typeof step.input === 'string') {
      try { step.input = JSON.parse(step.input) } catch { /* leave as-is */ }
    }
    // pass_output and input are mutually exclusive — strip input if pass_output is set
    if (step.pass_output === true && step.input !== undefined) {
      delete step.input
    }
    // Normalize "agent" → "agent_slug" (some LLMs output wrong key)
    if (!step.agent_slug && step.agent) {
      step.agent_slug = step.agent
      delete step.agent
    }
    return step
  })

  // 10. Filter by validSlugs BEFORE compose
  const validSlugs = new Set(agents.map(a => a.slug))
  const filteredSteps = normalizedSteps.filter(s => validSlugs.has((s as Record<string, unknown>).agent_slug as string))

  if (filteredSteps.length === 0) {
    return NextResponse.json(
      {
        error: 'I can only answer questions about DeFi and crypto on Avalanche.',
        code: 'no_agents_matched',
      },
      { status: 422 }
    )
  }

  // 11. Limit to 5
  const limitedSteps = filteredSteps.slice(0, 5)

  // 12. Forward to compose
  const composeUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/compose`

  let composeResult: unknown
  let composeOk = false
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 50000)
    const composeRes = await fetch(composeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ steps: limitedSteps }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    composeResult = await composeRes.json()
    composeOk = composeRes.ok
  } catch (err) {
    logger.error('[chat] compose fetch error', { err })
    return NextResponse.json(
      { error: 'Pipeline execution failed', code: 'compose_failed' },
      { status: 502 }
    )
  }

  // 13. If !composeOk → 502
  if (!composeOk) {
    const errResult = composeResult as { error?: string; steps?: unknown[]; receipts?: unknown[] }
    return NextResponse.json(
      {
        error: errResult?.error ?? 'Pipeline execution failed',
        code: 'compose_failed',
        steps: errResult?.steps ?? [],
        receipts: errResult?.receipts ?? [],
      },
      { status: 502 }
    )
  }

  // 14. Summarize with LLM (fail-open)
  let answer: string
  try {
    const summaryResponse = await callLLM({
      messages: [
        { role: 'system', content: SUMMARY_SYSTEM },
        { role: 'user', content: JSON.stringify(composeResult) },
      ],
      temperature: 0.3,
      maxTokens: 256,
    })
    answer = summaryResponse.result
  } catch (err) {
    logger.error('[chat] summary LLM error (fail-open)', { err })
    answer = JSON.stringify(composeResult)
  }

  const result = composeResult as {
    receipts?: Array<{ step: number; agent_slug: string; cost_usdc: string; receipt_signature: string }>
    total_cost_usdc?: string
    pipeline_id?: string
  }

  // 15. Build steps from receipts
  steps = (result.receipts ?? []).map(r => ({
    step:              r.step,
    agent_slug:        r.agent_slug,
    cost_usdc:         r.cost_usdc,
    status:            'success',
    receipt_signature: r.receipt_signature,
  }))

  // 16. Return response
  return NextResponse.json({
    answer,
    steps,
    receipts: result.receipts ?? [],
    total_cost_usdc: result.total_cost_usdc ?? '0.000000',
    pipeline_id: result.pipeline_id ?? '',
  })
}
