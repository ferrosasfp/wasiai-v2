/**
 * env.test.ts — WKH-66 W1: AC-12 refine validation.
 *
 * Verifica que `V2_DELEGATE_TO_A2A` non-empty exige
 * `WASIAI_A2A_BASE_URL` + `WASIAI_V2_FORWARD_KEY`.
 *
 * El módulo `env.ts` ejecuta validación al import-time (singleton).
 * Para no romper otros tests, replicamos el schema con la misma lógica
 * de refine que `src/lib/env.ts`. Cualquier cambio al refine en env.ts
 * debe replicarse aquí (cheap insurance vs runtime crash en deploy).
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

const refineSchema = z
  .object({
    WASIAI_A2A_BASE_URL: z.string().url().optional(),
    WASIAI_V2_FORWARD_KEY: z.string().min(16).optional(),
    V2_DELEGATE_TO_A2A: z.string().optional().default(''),
  })
  .refine(
    (data) => {
      const delegated = (data.V2_DELEGATE_TO_A2A ?? '').trim()
      if (delegated.length === 0) return true
      return Boolean(data.WASIAI_A2A_BASE_URL) && Boolean(data.WASIAI_V2_FORWARD_KEY)
    },
    {
      message:
        'V2_DELEGATE_TO_A2A is non-empty but WASIAI_A2A_BASE_URL or WASIAI_V2_FORWARD_KEY is missing',
      path: ['V2_DELEGATE_TO_A2A'],
    },
  )

describe('env — WKH-66 refine (AC-12)', () => {
  it('AC-13 happy: empty V2_DELEGATE_TO_A2A is always valid', () => {
    const out = refineSchema.safeParse({})
    expect(out.success).toBe(true)
  })

  it('AC-13 happy: explicit empty string V2_DELEGATE_TO_A2A is valid', () => {
    const out = refineSchema.safeParse({ V2_DELEGATE_TO_A2A: '' })
    expect(out.success).toBe(true)
  })

  it('AC-12 happy: V2_DELEGATE_TO_A2A=compose with both deps set is valid', () => {
    const out = refineSchema.safeParse({
      V2_DELEGATE_TO_A2A: 'compose',
      WASIAI_A2A_BASE_URL: 'http://a2a.local',
      WASIAI_V2_FORWARD_KEY: 'a-very-long-shared-secret-key-32',
    })
    expect(out.success).toBe(true)
  })

  it('AC-12 sad: V2_DELEGATE_TO_A2A set but URL missing → fails', () => {
    const out = refineSchema.safeParse({
      V2_DELEGATE_TO_A2A: 'compose',
      WASIAI_V2_FORWARD_KEY: 'a-very-long-shared-secret-key-32',
    })
    expect(out.success).toBe(false)
  })

  it('AC-12 sad: V2_DELEGATE_TO_A2A set but FORWARD_KEY missing → fails', () => {
    const out = refineSchema.safeParse({
      V2_DELEGATE_TO_A2A: 'compose',
      WASIAI_A2A_BASE_URL: 'http://a2a.local',
    })
    expect(out.success).toBe(false)
  })

  it('AC-12 sad: V2_DELEGATE_TO_A2A=" " whitespace is treated as empty (valid)', () => {
    const out = refineSchema.safeParse({ V2_DELEGATE_TO_A2A: '   ' })
    expect(out.success).toBe(true)
  })

  it('WASIAI_V2_FORWARD_KEY < 16 chars → fails (independent of refine)', () => {
    const out = refineSchema.safeParse({
      WASIAI_V2_FORWARD_KEY: 'too-short',
    })
    expect(out.success).toBe(false)
  })
})
