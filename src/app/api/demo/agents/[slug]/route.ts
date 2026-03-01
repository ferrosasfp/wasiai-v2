/**
 * Demo agent execution endpoint
 * GET  /api/demo/agents/:slug → spec (capabilities, schema)
 * POST /api/demo/agents/:slug → execute (called by WasiAI invoke layer)
 *
 * These are WasiAI's own demo agents, powered by Groq (free).
 * They serve as the endpoint_url for demo agents registered in the marketplace.
 *
 * ⚠️ This endpoint is PUBLIC — authentication and payment enforcement
 *    happen at /api/v1/agents/[slug]/invoke (the WasiAI gateway layer).
 */

import { NextRequest, NextResponse } from 'next/server'
import { callGroq } from '@/lib/agents/groq'
import { getDemoAgent } from '@/lib/agents/demoAgents'
import { getInvokeLimit, getIdentifier, checkRateLimit } from '@/lib/ratelimit'

import { SITE_URL } from '@/lib/constants'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const agent = getDemoAgent(slug)

  if (!agent) {
    return NextResponse.json({ error: 'Demo agent not found' }, { status: 404 })
  }

  // SEC-001: Rate limiting — 60 req/min per IP for demo endpoints
  const identifier = getIdentifier(request, undefined)
  const rateLimitRes = await checkRateLimit(getInvokeLimit(), `demo:${identifier}`)
  if (rateLimitRes) return rateLimitRes

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const input = (body.input as string) ?? ''
  if (!input.trim()) {
    return NextResponse.json({ error: 'Missing input field' }, { status: 400 })
  }

  try {
    const response = await callGroq({
      messages: [
        { role: 'system',  content: agent.system_prompt },
        { role: 'user',    content: input },
      ],
      model:       agent.model,
      maxTokens:   agent.max_tokens,
      temperature: agent.temperature,
    })

    // Parse JSON output for structured agents (sentiment, extractor)
    let result: unknown = response.result
    if (['wasi-sentiment', 'wasi-extractor'].includes(slug)) {
      try {
        result = JSON.parse(response.result)
      } catch {
        // Return raw string if JSON parse fails
      }
    }

    return NextResponse.json({
      result,
      meta: {
        agent:      slug,
        model:      response.model,
        tokens:     response.tokens,
        latency_ms: response.latency_ms,
        powered_by: 'wasiai-native',
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent execution failed'

    if (msg.includes('GROQ_API_KEY')) {
      return NextResponse.json(
        { error: 'Agent not configured. Set GROQ_API_KEY in environment.' },
        { status: 503 },
      )
    }

    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const agent = getDemoAgent(slug)

  if (!agent) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json({
    schema:   'wasiai/agent-spec/v1',
    slug:     agent.slug,
    name:     agent.name,
    category: agent.category,
    price:    agent.price_per_call,
    currency: 'USDC',
    invoke_url:   `${SITE_URL}/api/v1/agents/${agent.slug}/invoke`,
    endpoint_url: `${SITE_URL}/api/demo/agents/${agent.slug}`,
    powered_by: 'groq/llama-3.1',
    input: {
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
      example: { input: agent.input_example },
    },
    output: {
      type: 'object',
      properties: {
        result: { type: ['string', 'object'] },
        meta:   { type: 'object' },
      },
      example: { result: agent.output_example },
    },
    mcp: {
      tool_name:   agent.mcp_tool_name,
      description: agent.mcp_description,
    },
  })
}
