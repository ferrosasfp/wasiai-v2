import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * WasiAI MCP Server Endpoint
 * 
 * Implements the Model Context Protocol (MCP) so any AI assistant
 * (Claude, ChatGPT, Cursor, etc.) can discover and call WasiAI models
 * as tools automatically.
 * 
 * GET  /api/v1/mcp         → Server info + tool list
 * POST /api/v1/mcp         → Execute a tool (call a model)
 */

export async function GET() {
  const supabase = await createClient()

  const { data: models } = await supabase
    .from('agents')
    .select('name, slug, description, category, price_per_call, capabilities')
    .eq('status', 'active')
    .limit(50)

  const tools = (models ?? []).map(model => ({
    name: `wasiai_${model.slug.replace(/-/g, '_')}`,
    description: `[WasiAI] ${model.description ?? model.name} — $${model.price_per_call}/call (${model.category})`,
    inputSchema: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'Input to send to the model',
        },
        options: {
          type: 'object',
          description: 'Optional parameters for the model',
        },
      },
      required: ['input'],
    },
  }))

  return NextResponse.json({
    schema: 'mcp/server/v1',
    name: 'WasiAI',
    description: 'AI model marketplace. Pay per call in USDC on Avalanche.',
    version: '1.0.0',
    tools,
    resources: [
      {
        uri: 'wasiai://catalog',
        name: 'Model Catalog',
        description: 'Browse all available AI models',
        mimeType: 'application/json',
      },
    ],
  })
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { method, params } = body

  if (method === 'tools/list') {
    const response = await GET()
    const data = await response.json()
    return NextResponse.json({ tools: data.tools })
  }

  if (method === 'tools/call') {
    const toolName: string = params?.name ?? ''
    // Convert tool name back to slug: wasiai_my_model -> my-model
    const slug = toolName.replace(/^wasiai_/, '').replace(/_/g, '-')
    const input = params?.arguments?.input

    if (!input) {
      return NextResponse.json({ error: 'input is required' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: model } = await supabase
      .from('agents')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'active')
      .single()

    if (!model) {
      return NextResponse.json({
        content: [{ type: 'text', text: `Model '${slug}' not found on WasiAI.` }],
        isError: true,
      })
    }

    // Forward to model endpoint
    if (!model.endpoint_url) {
      return NextResponse.json({
        content: [{ type: 'text', text: 'Model endpoint not configured.' }],
        isError: true,
      })
    }

    try {
      const upstream = await fetch(model.endpoint_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input, ...params?.arguments?.options }),
      })
      const result = await upstream.json()

      // Log the call
      await supabase.from('agent_calls').insert({
        agent_id: model.id,
        caller_type: 'agent',
        agent_id: 'mcp-client',
        amount_paid: model.price_per_call,
        status: 'success',
      })

      return NextResponse.json({
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      })
    } catch {
      return NextResponse.json({
        content: [{ type: 'text', text: 'Model call failed.' }],
        isError: true,
      })
    }
  }

  if (method === 'resources/read') {
    const supabase = await createClient()
    const { data: models } = await supabase
      .from('agents')
      .select('name, slug, description, category, price_per_call')
      .eq('status', 'active')

    return NextResponse.json({
      contents: [
        {
          uri: 'wasiai://catalog',
          mimeType: 'application/json',
          text: JSON.stringify(models, null, 2),
        },
      ],
    })
  }

  return NextResponse.json({ error: 'Unknown method' }, { status: 400 })
}
