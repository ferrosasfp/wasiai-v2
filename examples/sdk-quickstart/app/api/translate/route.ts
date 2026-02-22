// Ejemplo: route handler de Next.js — 3 líneas
// El SDK maneja pagos x402, CORS y respuesta estándar automáticamente

import { createNextHandler } from '@wasiai/sdk/nextjs'
import agent from './agent'

export const { POST, GET, OPTIONS } = createNextHandler(agent, {
  treasury: process.env.WASIAI_TREASURY!,
})
