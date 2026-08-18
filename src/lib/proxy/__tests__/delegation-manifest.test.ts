/**
 * delegation-manifest.test.ts — WKH-361 W1 · T-12.
 *
 * El manifiesto es un módulo puro (sin `@/lib/env`, sin `server-only`), así
 * que este archivo NO necesita mock de env: si alguna vez lo necesitara,
 * sería la señal de que el módulo dejó de ser puro (CD-8).
 */
import { describe, it, expect } from 'vitest'
import {
  DELEGATION_MANIFEST,
  normalizeHost,
  resolveDeclaration,
} from '../delegation-manifest'

describe('normalizeHost', () => {
  it('recorta, baja a minúsculas y saca el puerto', () => {
    expect(normalizeHost('  APP.WasiAI.io  ')).toBe('app.wasiai.io')
    expect(normalizeHost('app.wasiai.io:443')).toBe('app.wasiai.io')
    expect(normalizeHost('localhost:3000')).toBe('localhost')
  })

  it('devuelve null para null, vacío o sólo espacios', () => {
    expect(normalizeHost(null)).toBeNull()
    expect(normalizeHost('')).toBeNull()
    expect(normalizeHost('   ')).toBeNull()
    expect(normalizeHost(':3000')).toBeNull()
  })

  it('conserva la forma con corchetes de IPv6 y le saca el puerto', () => {
    expect(normalizeHost('[::1]:3000')).toBe('[::1]')
    expect(normalizeHost('[::1]')).toBe('[::1]')
  })
})

describe('resolveDeclaration (T-12)', () => {
  it('resuelve app.wasiai.io a wasiai-prod', () => {
    const d = resolveDeclaration('app.wasiai.io')
    expect(d?.key).toBe('wasiai-prod')
    expect(d?.vercelProject).toBe('wasiai-prod')
    expect([...(d?.delegated ?? [])].sort()).toEqual([
      'capabilities',
      'compose',
      'orchestrate',
    ])
  })

  it('normaliza mayúsculas y puerto antes de matchear', () => {
    expect(resolveDeclaration('APP.WASIAI.IO')?.key).toBe('wasiai-prod')
    expect(resolveDeclaration('app.wasiai.io:443')?.key).toBe('wasiai-prod')
    expect(resolveDeclaration('  Wasiai-V2.Vercel.App  ')?.key).toBe('wasiai-v2')
  })

  it('resuelve wasiai-prod.vercel.app al mismo ambiente que app.wasiai.io', () => {
    expect(resolveDeclaration('wasiai-prod.vercel.app')?.key).toBe('wasiai-prod')
  })

  it('wasiai-v2.vercel.app declara CERO endpoints delegados (DT-2 B+)', () => {
    const d = resolveDeclaration('wasiai-v2.vercel.app')
    expect(d?.key).toBe('wasiai-v2')
    expect(d?.delegated).toEqual([])
  })

  it('host desconocido devuelve null — fail-loud, sin comodines', () => {
    expect(resolveDeclaration('example.com')).toBeNull()
    expect(resolveDeclaration('otra-cosa.vercel.app')).toBeNull()
    // Sufijo/prefijo no alcanzan: el match es exacto. Un comodín
    // `*.vercel.app` haría que cualquier preview se hiciera pasar por un
    // ambiente declarado, que es la familia de error que abrió esta HU.
    expect(resolveDeclaration('evil-app.wasiai.io')).toBeNull()
    expect(resolveDeclaration('app.wasiai.io.evil.test')).toBeNull()
    expect(resolveDeclaration(null)).toBeNull()
    expect(resolveDeclaration('')).toBeNull()
  })
})

describe('DELEGATION_MANIFEST — invariantes (T-12)', () => {
  it('ningún host se repite entre dos ambientes', () => {
    // Si dos ambientes compartieran un host, `resolveDeclaration` devolvería
    // el primero y AC-6 (identificadores distintos por ambiente) quedaría
    // roto en silencio.
    const all = DELEGATION_MANIFEST.flatMap((d) => [...d.hosts])
    expect(new Set(all).size).toBe(all.length)
  })

  it('ninguna `key` se repite', () => {
    const keys = DELEGATION_MANIFEST.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('todos los hosts están normalizados (minúsculas, sin puerto)', () => {
    for (const d of DELEGATION_MANIFEST) {
      for (const h of d.hosts) {
        expect(h).toBe(normalizeHost(h))
      }
    }
  })

  it('ningún ambiente declara `mcp` como delegado (CLAUDE.md:101)', () => {
    for (const d of DELEGATION_MANIFEST) {
      expect(d.delegated).not.toContain('mcp')
    }
  })

  it('cada ambiente trae `measuredAt` con forma YYYY-MM-DD y una `evidence` no vacía', () => {
    for (const d of DELEGATION_MANIFEST) {
      expect(d.measuredAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(d.evidence.trim().length).toBeGreaterThan(0)
    }
  })
})
