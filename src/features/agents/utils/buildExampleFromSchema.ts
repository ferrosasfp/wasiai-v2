/**
 * buildExampleFromSchema — Genera un ejemplo de input ejecutable desde un JSON Schema.
 * 
 * Reglas:
 * - Nunca devuelve strings con < o >
 * - El output es siempre JSON.parse()-able
 * - Función pura sin side effects
 * - Solo incluye campos en required[] (o todos si required está ausente)
 */

type SchemaProperty = {
  type?: string
  description?: string
  enum?: unknown[]
  default?: unknown
  properties?: Record<string, SchemaProperty>
  required?: string[]
  items?: SchemaProperty
}

type JsonSchema = {
  type?: string
  properties?: Record<string, SchemaProperty>
  required?: string[]
  description?: string
}

/** Heurísticas de inferencia de valor por key/description (case-insensitive) */
function inferStringValue(key: string, description?: string): string {
  const haystack = `${key} ${description ?? ''}`.toLowerCase()
  
  // Omitir campos opcionales explícitos
  if (haystack.includes('optional') || description?.toLowerCase().startsWith('optional')) {
    return '__OMIT__'
  }
  
  if (haystack.match(/address|wallet|0x/)) return '0xAbCd1234567890AbCd1234567890AbCd12345678'
  if (haystack.match(/token|symbol/))      return 'AVAX'
  if (haystack.match(/email/))             return 'user@example.com'
  if (haystack.match(/url|endpoint/))      return 'https://example.com'
  if (haystack.match(/uuid|id\b/))         return 'abc-123'
  if (haystack.match(/name/))              return 'My Agent'
  if (haystack.match(/text|content|message|query|prompt/)) return 'Hello world'
  
  return '' // fallback: string vacío
}

function buildValueFromProperty(key: string, prop: SchemaProperty): unknown {
  const type = prop.type ?? 'string'
  
  if (type === 'string') {
    if (prop.enum && prop.enum.length > 0) return prop.enum[0]
    return inferStringValue(key, prop.description)
  }
  if (type === 'number' || type === 'integer') return 0
  if (type === 'boolean') return true
  if (type === 'array') return []
  if (type === 'object' && prop.properties) {
    return buildObjectFromSchema(prop)
  }
  return {}
}

function buildObjectFromSchema(schema: JsonSchema): Record<string, unknown> {
  const props = schema.properties
  if (!props) return {}
  
  const required = schema.required // undefined = incluir todos
  const example: Record<string, unknown> = {}
  
  for (const [key, def] of Object.entries(props)) {
    // Si required está definido, solo incluir campos requeridos
    if (required && !required.includes(key)) continue
    
    const value = buildValueFromProperty(key, def)
    if (value === '__OMIT__') continue
    example[key] = value
  }
  
  return example
}

/**
 * Genera un ejemplo de input ejecutable desde un JSON Schema.
 * @returns string JSON válido, o null si el schema no puede procesarse.
 */
export function buildExampleFromSchema(schema: JsonSchema | null | undefined): string | null {
  if (!schema) return null
  
  if (schema.type === 'object' || schema.properties) {
    const obj = buildObjectFromSchema(schema)
    // Si quedó vacío (sin campos required útiles), devolver null para usar fallback
    if (Object.keys(obj).length === 0) return null
    return JSON.stringify(obj, null, 2)
  }
  
  if (schema.type === 'string') {
    const val = inferStringValue('input', schema.description)
    if (val === '__OMIT__') return null
    return JSON.stringify({ input: val })
  }
  
  return null
}

export const EXAMPLE_FALLBACK = '{"input": ""}'
