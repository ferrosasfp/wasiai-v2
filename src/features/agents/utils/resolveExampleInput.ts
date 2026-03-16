import { buildExampleFromSchema, EXAMPLE_FALLBACK } from './buildExampleFromSchema'

interface AgentLike {
  metadata?: Record<string, unknown> | null
  capabilities?: Array<{ example_input?: string; [k: string]: unknown }> | null
  input_schema?: Record<string, unknown> | null
}

function isValidJson(str: unknown): str is string {
  if (typeof str !== 'string' || !str.trim()) return false
  try { JSON.parse(str); return true } catch { return false }
}

/**
 * Resuelve el ejemplo de input de un agente según jerarquía:
 * 1. metadata.input_example (string JSON válido)
 * 2. capabilities[0].example_input (string JSON válido)
 * 3. buildExampleFromSchema(input_schema)
 * 4. EXAMPLE_FALLBACK '{"input":""}'
 *
 * @returns siempre un string JSON válido, nunca null
 */
export function resolveExampleInput(agent: AgentLike): string {
  // 1. metadata.input_example
  const metaExample = agent.metadata?.input_example
  if (isValidJson(metaExample)) return metaExample as string

  // 2. capabilities[0].example_input
  const capExample = agent.capabilities?.[0]?.example_input
  if (isValidJson(capExample)) return capExample as string

  // 3. buildExampleFromSchema
  const schemaExample = buildExampleFromSchema(agent.input_schema)
  if (schemaExample) return schemaExample

  // 4. fallback garantizado
  return EXAMPLE_FALLBACK
}
