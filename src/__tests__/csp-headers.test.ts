/**
 * AC-5 (H-4): la directiva script-src del CSP estático en next.config.mjs
 * no debe contener 'unsafe-inline' ni 'unsafe-eval'.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('AC-5: next.config.mjs script-src sin unsafe-*', () => {
  const config = readFileSync(resolve(process.cwd(), 'next.config.mjs'), 'utf-8')
  const match = config.match(/"script-src[^"]*"/)
  const scriptSrcLine = match ? match[0] : ''

  it('encuentra la directiva script-src', () => {
    expect(scriptSrcLine).not.toBe('')
  })

  it("script-src no contiene 'unsafe-inline'", () => {
    expect(scriptSrcLine).not.toContain("'unsafe-inline'")
  })

  it("script-src no contiene 'unsafe-eval'", () => {
    expect(scriptSrcLine).not.toContain("'unsafe-eval'")
  })

  it("script-src conserva 'self'", () => {
    expect(scriptSrcLine).toContain("'self'")
  })
})
