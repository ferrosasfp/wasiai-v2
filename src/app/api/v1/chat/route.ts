import { NextRequest, NextResponse } from 'next/server'
import { callLLM } from '@/lib/agents/llm'

export const maxDuration = 60

const PLANNER_SYSTEM = `You are WasiAI's pipeline planner. Given a user question about DeFi/crypto, return a JSON array of ComposeStep objects.

Available agents (ONLY these 5 exist in production):
- wasi-chainlink-price: real-time token prices from Chainlink oracles (input: {"token": "SYMBOL"})
- wasi-defi-sentiment: sentiment analysis and scam detection (input: {"token": "SYMBOL"})  
- wasi-onchain-analyzer: on-chain token data, holder info, contract analysis (input: {"token": "SYMBOL"} or {"address": "0x..."})
- wasi-contract-auditor: smart contract security audit (input: {"address": "0x..."})
- wasi-risk-report: comprehensive risk report combining multiple data sources (input: {"token": "SYMBOL"})

Rules:
- Return ONLY a valid JSON array, no explanation
- First step MUST have "input" with the extracted parameters
- Subsequent steps use "pass_output": true
- Maximum 5 steps
- If the question is not about DeFi/crypto, return []

Format: [{"agent_slug":"...","input":"..."},{"agent_slug":"...","pass_output":true}]`

const SUMMARY_SYSTEM = `You are a DeFi analyst. Summarize the following agent pipeline results in 2-3 clear sentences for a non-technical user. Always include the exact token price in USD if available (e.g. "AVAX is currently $9.49"). Include key numbers (prices, scores, risk ratings, liquidity). Be concise.`

export async function POST(req: NextRequest) {
  // Validate API key
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Agent Key required', code: 'missing_key' },
      { status: 401 }
    )
  }

  // Parse body
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

  // Step 1: LLM interprets question into pipeline steps
  let plannerResponse
  try {
    plannerResponse = await callLLM({
      messages: [
        { role: 'system', content: PLANNER_SYSTEM },
        { role: 'user', content: question },
      ],
      temperature: 0,
      maxTokens: 512,
    })
  } catch (err) {
    console.error('[chat] planner LLM error:', err)
    return NextResponse.json(
      { error: 'Failed to interpret question', code: 'compose_failed' },
      { status: 500 }
    )
  }

  // Parse the LLM output
  let steps: unknown[]
  try {
    const raw = plannerResponse.result.trim()
    // Extract JSON array if wrapped in markdown code blocks
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

  // Validate: must have 1-5 steps
  if (steps.length === 0) {
    return NextResponse.json(
      {
        error: 'I can only answer questions about DeFi and crypto on Avalanche.',
        code: 'no_agents_matched',
      },
      { status: 422 }
    )
  }

  const limitedSteps = steps.slice(0, 5)

  // Step 2: Forward to compose
  const composeUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'}/api/v1/compose`

  let composeResult: unknown
  let composeOk = false
  try {
    const composeRes = await fetch(composeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ steps: limitedSteps }),
    })

    composeResult = await composeRes.json()
    composeOk = composeRes.ok
  } catch (err) {
    console.error('[chat] compose fetch error:', err)
    return NextResponse.json(
      { error: 'Pipeline execution failed', code: 'compose_failed' },
      { status: 502 }
    )
  }

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

  // Step 3: Summarize results with LLM (fail-open)
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
    console.error('[chat] summary LLM error (fail-open):', err)
    // Fail-open: return raw compose result as answer
    answer = JSON.stringify(composeResult)
  }

  const result = composeResult as {
    receipts?: Array<{ step: number; agent_slug: string; cost_usdc: string; receipt_signature: string }>
    total_cost_usdc?: string
    pipeline_id?: string
  }

  // Build pipeline steps from receipts (compose returns receipts, not a steps array)
  steps = (result.receipts ?? []).map(r => ({
    step:              r.step,
    agent_slug:        r.agent_slug,
    cost_usdc:         r.cost_usdc,
    status:            'success',
    receipt_signature: r.receipt_signature,
  }))

  return NextResponse.json({
    answer,
    steps,
    receipts: result.receipts ?? [],
    total_cost_usdc: result.total_cost_usdc ?? '0.000000',
    pipeline_id: result.pipeline_id ?? '',
  })
}
