// Tipo interno del editor (incluye id para React keys — nunca enviado a la API)
export type Capability = {
  id: string             // crypto.randomUUID() — solo frontend
  name: string           // obligatorio
  description: string    // obligatorio
  input_type: string     // select controlado
  output_type: string    // select controlado
  example_input: string  // opcional
  example_output: string // opcional
}

// Tipo que la API espera (sin id)
export type CapabilityPayload = Omit<Capability, 'id'>

// Opciones de los selects
export const INPUT_TYPES = ['text', 'json', 'url', 'image', 'audio', 'any'] as const
export const OUTPUT_TYPES = ['text', 'json', 'markdown', 'code', 'any'] as const
