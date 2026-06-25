/**
 * V14 (audit 2026-06-25) — background work in register must run via after().
 *
 * The on-chain DB update and the health probe were previously scheduled as a
 * floating `.then().catch()` / bare fire-and-forget. On serverless (Vercel) the
 * runtime can tear down the function before that work resolves → lost update.
 *
 * Wrapping them in next/server `after()` keeps the runtime alive until they
 * finish. Driving the full POST handler requires mocking ~10 collaborators; this
 * source-level guard is a stable regression check that the fix stays in place.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const routeSrc = readFileSync(
  resolve(__dirname, '../route.ts'),
  'utf-8',
)

describe('V14 — register background work uses after()', () => {
  it('imports after from next/server', () => {
    expect(routeSrc).toMatch(/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*'next\/server'/)
  })

  it('schedules the on-chain registration + DB update inside after()', () => {
    // registerAgentOnChain is awaited inside an after() callback, not chained
    // as a floating .then().catch().
    expect(routeSrc).toMatch(/after\(async \(\) => \{[\s\S]*registerAgentOnChain/)
    // The old floating pattern must be gone.
    expect(routeSrc).not.toMatch(/registerAgentOnChain\([\s\S]*?\)\s*\.then\(/)
  })

  it('schedules the health probe inside after()', () => {
    expect(routeSrc).toMatch(/after\(\(\) =>\s*[\s\S]*probeEndpoint\(/)
  })
})
