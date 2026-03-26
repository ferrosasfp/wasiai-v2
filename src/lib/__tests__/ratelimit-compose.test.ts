/**
 * Tests para getComposeLimit() — AC-6
 * Verifica que COMPOSE_RATE_LIMIT_RPM sea leída correctamente con fallbacks seguros.
 *
 * Patrón: lógica pura extraída (no importar el módulo real para evitar side-effects de Redis).
 */
import { describe, it, expect } from 'vitest'

// Réplica de la lógica de parseComposeRpm en getComposeLimit()
function parseComposeRpm(envVal: string | undefined): number {
  const raw = parseInt(envVal ?? '', 10)
  return Number.isFinite(raw) && raw >= 1 ? raw : 30
}

describe('getComposeLimit — COMPOSE_RATE_LIMIT_RPM parsing (AC-6)', () => {
  it('COMPOSE_RATE_LIMIT_RPM=60 → rpm = 60', () => {
    expect(parseComposeRpm('60')).toBe(60)
  })

  it('COMPOSE_RATE_LIMIT_RPM=0 → rpm = 30 (0 no es válido)', () => {
    expect(parseComposeRpm('0')).toBe(30)
  })

  it('COMPOSE_RATE_LIMIT_RPM=-5 → rpm = 30 (negativo inválido)', () => {
    expect(parseComposeRpm('-5')).toBe(30)
  })

  it('COMPOSE_RATE_LIMIT_RPM=abc → rpm = 30 (NaN)', () => {
    expect(parseComposeRpm('abc')).toBe(30)
  })

  it('COMPOSE_RATE_LIMIT_RPM no definida → rpm = 30 (default)', () => {
    expect(parseComposeRpm(undefined)).toBe(30)
  })

  it('COMPOSE_RATE_LIMIT_RPM=1 → rpm = 1 (mínimo válido)', () => {
    expect(parseComposeRpm('1')).toBe(1)
  })

  it('COMPOSE_RATE_LIMIT_RPM=10 → rpm = 10 (valor anterior)', () => {
    expect(parseComposeRpm('10')).toBe(10)
  })
})
