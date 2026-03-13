import Ajv from 'ajv'
import addFormats from 'ajv-formats'

const ajv = new Ajv({ strict: false })
addFormats(ajv)

/**
 * Meta-valida que un valor sea un JSON Schema draft-07 válido.
 * Bloquea $ref con URLs externas (prevención SSRF).
 */
export function metaValidateSchema(schema: unknown): { valid: boolean; error?: string } {
  // AC-3: Bloquear $ref con URL http/https (recursivo)
  const ssrfError = findExternalRefs(schema)
  if (ssrfError) {
    return { valid: false, error: ssrfError }
  }

  // AC-2: Meta-validar que sea JSON Schema draft-07 válido
  try {
    ajv.compile(schema as object)
    return { valid: true }
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Invalid JSON Schema' }
  }
}

/**
 * Valida un input contra un JSON Schema.
 * Retorna null si válido, string de error si inválido.
 * Si schema es null/undefined, retorna null (sin validación — AC-7).
 */
export function validateInput(schema: unknown, input: unknown): string | null {
  if (schema === null || schema === undefined) return null

  try {
    const validate = ajv.compile(schema as object)
    const valid = validate(input)
    if (!valid) {
      return ajv.errorsText(validate.errors)
    }
    return null
  } catch {
    return null // schema inválido no debe romper el flujo (ya fue validado al guardar)
  }
}

/**
 * Busca recursivamente $ref con URLs externas.
 * Retorna mensaje de error o null si no hay riesgo SSRF.
 */
function findExternalRefs(obj: unknown, path = ''): string | null {
  if (typeof obj !== 'object' || obj === null) return null

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const r = findExternalRefs(obj[i], `${path}[${i}]`)
      if (r) return r
    }
    return null
  }

  const record = obj as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key === '$ref' && typeof record[key] === 'string') {
      const ref = record[key] as string
      if (ref.startsWith('http://') || ref.startsWith('https://')) {
        return `External $ref blocked at ${path}.$ref: ${ref}`
      }
    }
    const r = findExternalRefs(record[key], `${path}.${key}`)
    if (r) return r
  }
  return null
}
