// src/app/api/v1/compose/__tests__/pipeline-v2.test.ts
// Tests integrales compose pipeline v2
// Patrón: lógica pura extraída directamente (sin importar route.ts con side-effects de env)
// Covers: validateSteps, groupSteps, parseOutputSafe, transformStepOutput, pipelineCtx

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── transformStepOutput — lógica extraída para testeo aislado ────────────────
// (no importamos el módulo real para evitar que vi.mock lance errores al runner)

type TransformResult = { transformed: string; warning?: string }
type LLMCallFn = (opts: { messages: unknown[]; temperature: number; maxTokens: number; timeoutMs: number }) => Promise<{ result: string; provider: string; tokens: number }>

async function transformStepOutputLocal(
  previousOutput: string,
  _targetSchema: Record<string, unknown>,
  targetSlug: string,
  timeoutMs = 3000,
  callLLM: LLMCallFn,
): Promise<TransformResult> {
  try {
    const response = await callLLM({
      messages: [
        { role: 'system', content: 'You are a JSON transformer. Return ONLY valid JSON.' },
        { role: 'user', content: `Previous: ${previousOutput}\nSlug: ${targetSlug}` },
      ],
      temperature: 0,
      maxTokens: 512,
      timeoutMs,
    })
    try {
      const parsed = JSON.parse(response.result)
      return { transformed: JSON.stringify(parsed) }
    } catch {
      return { transformed: previousOutput, warning: 'invalid_json_from_llm' }
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return { transformed: previousOutput, warning: 'transform_timeout' }
    }
    return { transformed: previousOutput, warning: `all_providers_failed: ${error.message}` }
  }
}

const mockCallLLM = vi.fn<Parameters<LLMCallFn>, ReturnType<LLMCallFn>>()

// ── Lógica extraída de compose/route.ts ─────────────────────────────────────

const MAX_STEPS = 5

interface ComposeStep {
  agent_slug?: string
  capability?: string
  input?: string
  pass_output?: boolean
  parallel?: boolean
  receive_input?: boolean
}

function validateSteps(steps: unknown): string | null {
  if (!Array.isArray(steps)) return 'steps must be an array'
  if (steps.length < 1) return 'steps must have at least 1 element'
  if (steps.length > MAX_STEPS) return `Max ${MAX_STEPS} steps per pipeline`

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] as ComposeStep

    if (s.capability && s.agent_slug) {
      return `Step ${i}: capability and agent_slug are mutually exclusive`
    }
    if (!s.capability && (!s.agent_slug || typeof s.agent_slug !== 'string')) {
      return `Step ${i}: agent_slug or capability is required`
    }
    if (s.input !== undefined && s.pass_output === true) {
      return `Step ${i}: input and pass_output are mutually exclusive`
    }
    if (i === 0 && s.pass_output === true) {
      return 'Step 0 cannot use pass_output (no previous output exists)'
    }
    if (s.receive_input === true && s.input !== undefined) {
      return `Step ${i}: receive_input and input are mutually exclusive`
    }
    if (i === 0 && s.receive_input === true) {
      return 'Step 0 cannot use receive_input (no previous output exists)'
    }
    if (s.receive_input === true && !s.parallel) {
      return `Step ${i}: receive_input is only valid on parallel steps`
    }
    if (
      !s.pass_output &&
      !s.receive_input &&
      (s.input === undefined || (typeof s.input === 'string' && s.input.trim() === ''))
    ) {
      return `Step ${i}: input is required when pass_output is false`
    }
  }
  return null
}

function groupSteps(steps: ComposeStep[]): ComposeStep[][] {
  const groups: ComposeStep[][] = []
  let i = 0
  while (i < steps.length) {
    if (steps[i].parallel) {
      const group: ComposeStep[] = []
      while (i < steps.length && steps[i].parallel) group.push(steps[i++])
      groups.push(group)
    } else {
      groups.push([steps[i++]])
    }
  }
  return groups
}

function parseOutputSafe(raw: string | null): unknown {
  if (raw === null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function extractCtxPatch(
  stepOutput: unknown,
  outputSchema: unknown,
): Record<string, string | number | boolean> {
  const patch: Record<string, string | number | boolean> = {}
  if (!stepOutput || typeof stepOutput !== 'object' || !outputSchema) return patch
  const schema = outputSchema as Record<string, unknown>
  const properties = schema.properties
  if (!properties || typeof properties !== 'object') return patch
  const top = stepOutput as Record<string, unknown>
  const src =
    top.result && typeof top.result === 'object'
      ? (top.result as Record<string, unknown>)
      : top
  for (const key of Object.keys(properties as Record<string, unknown>)) {
    if (key === 'input') continue
    const val = src[key]
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      patch[key] = val
    }
  }
  return patch
}

// ── Helper ───────────────────────────────────────────────────────────────────
function step(overrides: Record<string, unknown> = {}): ComposeStep {
  return { agent_slug: 'agent-a', input: 'hello', ...overrides } as ComposeStep
}

// ── Suite 1: validateSteps — receive_input ───────────────────────────────────
describe('validateSteps — receive_input', () => {
  it('receive_input + input defined → mutually exclusive error', () => {
    const result = validateSteps([
      step(),
      { agent_slug: 'agent-b', parallel: true, receive_input: true, input: 'bar' },
    ])
    expect(result).toContain('mutually exclusive')
  })

  it('step 0 with receive_input → cannot use receive_input error', () => {
    const result = validateSteps([
      { agent_slug: 'agent-a', parallel: true, receive_input: true },
    ])
    expect(result).toContain('cannot use receive_input')
  })

  it('receive_input on non-parallel step → only valid on parallel steps error', () => {
    const result = validateSteps([
      step(),
      { agent_slug: 'agent-b', receive_input: true },
    ])
    expect(result).toContain('only valid on parallel steps')
  })

  it('receive_input without input and without pass_output → no error (exempt from input required)', () => {
    const result = validateSteps([
      step(),
      { agent_slug: 'agent-b', parallel: true, receive_input: true },
    ])
    expect(result).toBeNull()
  })

  it('receive_input + parallel: true → no error', () => {
    const result = validateSteps([
      step(),
      { agent_slug: 'agent-b', parallel: true, receive_input: true },
    ])
    expect(result).toBeNull()
  })

  it('receive_input + parallel: true on step 1 (not step 0) → no error', () => {
    const result = validateSteps([
      step(),
      { agent_slug: 'agent-b', parallel: true, receive_input: true },
      { agent_slug: 'agent-c', parallel: true, receive_input: true },
    ])
    expect(result).toBeNull()
  })
})

// ── Suite 2: validateSteps — regresión ──────────────────────────────────────
describe('validateSteps — regresión pass_output', () => {
  it('step 0 with pass_output → error', () => {
    const result = validateSteps([{ agent_slug: 'agent-a', pass_output: true }])
    expect(result).toContain('Step 0')
    expect(result).toContain('pass_output')
  })

  it('input + pass_output together → error', () => {
    const result = validateSteps([
      step(),
      { agent_slug: 'agent-b', input: 'x', pass_output: true },
    ])
    expect(result).toContain('mutually exclusive')
  })

  it('no input, no pass_output, no receive_input → input is required error', () => {
    const result = validateSteps([
      step(),
      { agent_slug: 'agent-b' },
    ])
    expect(result).toContain('input is required')
  })

  it('valid 2-step sequential pipeline → null', () => {
    const result = validateSteps([
      step(),
      { agent_slug: 'agent-b', pass_output: true },
    ])
    expect(result).toBeNull()
  })

  it('5-step pipeline (MAX) → null; 6-step → error', () => {
    const fiveSteps = [
      step(),
      { agent_slug: 'b', pass_output: true },
      { agent_slug: 'c', pass_output: true },
      { agent_slug: 'd', pass_output: true },
      { agent_slug: 'e', pass_output: true },
    ]
    expect(validateSteps(fiveSteps)).toBeNull()
    const sixSteps = [...fiveSteps, { agent_slug: 'f', pass_output: true }]
    expect(validateSteps(sixSteps)).toContain('Max 5')
  })

  it('empty steps array → error', () => {
    expect(validateSteps([])).toBeTruthy()
  })

  it('capability + agent_slug together → error', () => {
    const result = validateSteps([
      { agent_slug: 'agent-a', capability: 'some-cap', input: 'x' },
    ])
    expect(result).toContain('mutually exclusive')
  })
})

// ── Suite 3: groupSteps ──────────────────────────────────────────────────────
describe('groupSteps', () => {
  it('all sequential → each step in its own group', () => {
    const steps: ComposeStep[] = [
      { agent_slug: 'a', input: 'x' },
      { agent_slug: 'b', input: 'y' },
      { agent_slug: 'c', input: 'z' },
    ]
    const groups = groupSteps(steps)
    expect(groups).toHaveLength(3)
    groups.forEach((g, i) => {
      expect(g).toHaveLength(1)
      expect(g[0]).toBe(steps[i])
    })
  })

  it('two consecutive parallel steps → grouped together', () => {
    const steps: ComposeStep[] = [
      { agent_slug: 'a', parallel: true, input: 'x' },
      { agent_slug: 'b', parallel: true, input: 'y' },
    ]
    const groups = groupSteps(steps)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })

  it('serial-parallel-serial mix → 3 groups', () => {
    const steps: ComposeStep[] = [
      { agent_slug: 'a', input: 'x' },
      { agent_slug: 'b', parallel: true, input: 'y' },
      { agent_slug: 'c', parallel: true, input: 'z' },
      { agent_slug: 'd', input: 'w' },
    ]
    const groups = groupSteps(steps)
    expect(groups).toHaveLength(3)
    expect(groups[0]).toHaveLength(1)
    expect(groups[1]).toHaveLength(2)
    expect(groups[2]).toHaveLength(1)
  })

  it('all parallel → 1 group', () => {
    const steps: ComposeStep[] = [
      { agent_slug: 'a', parallel: true, input: 'x' },
      { agent_slug: 'b', parallel: true, input: 'y' },
      { agent_slug: 'c', parallel: true, input: 'z' },
    ]
    const groups = groupSteps(steps)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })
})

// ── Suite 4: parseOutputSafe ─────────────────────────────────────────────────
describe('parseOutputSafe', () => {
  it('null → null', () => {
    expect(parseOutputSafe(null)).toBeNull()
  })

  it('valid JSON string → parsed object', () => {
    expect(parseOutputSafe('{"key":"value"}')).toEqual({ key: 'value' })
  })

  it('non-JSON string → original string', () => {
    const raw = 'not json at all'
    expect(parseOutputSafe(raw)).toBe(raw)
  })

  it('JSON array → array', () => {
    expect(parseOutputSafe('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('empty string → empty string (not null)', () => {
    expect(parseOutputSafe('')).toBe('')
  })
})

// ── Suite 5: transformStepOutput ─────────────────────────────────────────────
describe('transformStepOutput', () => {
  beforeEach(() => mockCallLLM.mockReset())

  const schema = { type: 'object', properties: { key: { type: 'string' } } }
  const call = (prev: string, s = schema, slug = 'agent-b', ms?: number) =>
    transformStepOutputLocal(prev, s, slug, ms, mockCallLLM as LLMCallFn)

  it('success: LLM returns valid JSON → { transformed } without warning', async () => {
    mockCallLLM.mockResolvedValue({ result: '{"key":"value"}', provider: 'groq', tokens: 10 })
    const result: TransformResult = await call('prev')
    expect(result.transformed).toBe('{"key":"value"}')
    expect(result.warning).toBeUndefined()
  })

  it('invalid JSON from LLM → { transformed: previousOutput, warning: invalid_json_from_llm }', async () => {
    mockCallLLM.mockResolvedValue({ result: 'not json', provider: 'groq', tokens: 5 })
    const result = await call('prev')
    expect(result.transformed).toBe('prev')
    expect(result.warning).toBe('invalid_json_from_llm')
  })

  it('callLLM throws generic Error → all_providers_failed warning', async () => {
    mockCallLLM.mockResolvedValue({ result: 'throw:Error:network error', provider: 'groq', tokens: 0 })
    // test the catch-path by calling with a real-throw stub
    const throwingFn: LLMCallFn = async () => { throw new Error('network error') }
    const result = await transformStepOutputLocal('prev', schema, 'agent-b', 3000, throwingFn)
    expect(result.transformed).toBe('prev')
    expect(result.warning).toContain('all_providers_failed')
    expect(result.warning).toContain('network error')
  })

  it('callLLM throws TimeoutError → transform_timeout warning', async () => {
    const throwingFn: LLMCallFn = async () => {
      const err = new Error('timeout'); err.name = 'TimeoutError'; throw err
    }
    const result = await transformStepOutputLocal('prev', schema, 'agent-b', 3000, throwingFn)
    expect(result.transformed).toBe('prev')
    expect(result.warning).toBe('transform_timeout')
  })

  it('callLLM throws AbortError → transform_timeout warning', async () => {
    const throwingFn: LLMCallFn = async () => {
      const err = new Error('aborted'); err.name = 'AbortError'; throw err
    }
    const result = await transformStepOutputLocal('prev', schema, 'agent-b', 3000, throwingFn)
    expect(result.transformed).toBe('prev')
    expect(result.warning).toBe('transform_timeout')
  })

  it('custom timeoutMs is passed to callLLM', async () => {
    mockCallLLM.mockResolvedValue({ result: '{}', provider: 'groq', tokens: 1 })
    await call('prev', schema, 'agent-b', 1500)
    expect(mockCallLLM).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 1500 }))
  })

  it('default timeoutMs = 3000 when not provided', async () => {
    mockCallLLM.mockResolvedValue({ result: '{}', provider: 'groq', tokens: 1 })
    await call('prev')
    expect(mockCallLLM).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 3000 }))
  })
})

// ── Suite 6: pipelineCtx dynamic extraction logic ────────────────────────────
describe('pipelineCtx dynamic extraction logic', () => {
  it('output with nested result → extracts from result (result-first)', () => {
    const output = { result: { name: 'Alice', score: 42 }, raw: 'ignored' }
    const schema = { properties: { name: {}, score: {} } }
    expect(extractCtxPatch(output, schema)).toEqual({ name: 'Alice', score: 42 })
  })

  it('output without result → extracts from root', () => {
    const output = { name: 'Bob', score: 99 }
    const schema = { properties: { name: {}, score: {} } }
    expect(extractCtxPatch(output, schema)).toEqual({ name: 'Bob', score: 99 })
  })

  it('field "input" in output_schema → NOT propagated', () => {
    const output = { input: 'should-not-appear', name: 'test' }
    const schema = { properties: { input: {}, name: {} } }
    const patch = extractCtxPatch(output, schema)
    expect(patch).not.toHaveProperty('input')
    expect(patch).toHaveProperty('name', 'test')
  })

  it('field with null value → NOT propagated', () => {
    const output = { name: null, score: 10 }
    const schema = { properties: { name: {}, score: {} } }
    const patch = extractCtxPatch(output, schema)
    expect(patch).not.toHaveProperty('name')
    expect(patch).toHaveProperty('score', 10)
  })

  it('field with array value → NOT propagated', () => {
    const output = { tags: ['a', 'b'], title: 'hello' }
    const schema = { properties: { tags: {}, title: {} } }
    const patch = extractCtxPatch(output, schema)
    expect(patch).not.toHaveProperty('tags')
    expect(patch).toHaveProperty('title', 'hello')
  })

  it('field with object value → NOT propagated', () => {
    const output = { meta: { x: 1 }, title: 'hi' }
    const schema = { properties: { meta: {}, title: {} } }
    const patch = extractCtxPatch(output, schema)
    expect(patch).not.toHaveProperty('meta')
    expect(patch).toHaveProperty('title', 'hi')
  })

  it('output_schema with anyOf (no properties) → returns empty patch without error', () => {
    const output = { name: 'test' }
    const schema = { anyOf: [{ type: 'string' }] }
    expect(() => extractCtxPatch(output, schema)).not.toThrow()
    expect(extractCtxPatch(output, schema)).toEqual({})
  })

  it('output_schema null → returns empty patch', () => {
    expect(extractCtxPatch({ name: 'test' }, null)).toEqual({})
  })

  it('multiple fields of different primitive types (string, number, boolean) → all propagated', () => {
    const output = { label: 'ok', count: 7, active: true }
    const schema = { properties: { label: {}, count: {}, active: {} } }
    expect(extractCtxPatch(output, schema)).toEqual({ label: 'ok', count: 7, active: true })
  })
})
