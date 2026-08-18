/**
 * validate-env-delegation.test.ts — WKH-361 fix-pack AR · `MNR-2`.
 *
 * ⚠️ UBICACIÓN A PROPÓSITO (CD-14), igual que `smoke-delegation.test.ts`:
 * `vitest.config.ts:10` fija `include: ['src/**\/*.test.{ts,tsx}']`, así que un
 * test en `scripts/__tests__/` no lo levanta nadie y `npm test` queda verde.
 *
 * ESTE ES EL ÚNICO CONTROL AUTOMÁTICO de `checkDelegationTrio`
 * (`scripts/validate-env.js`): `scripts/**` está fuera del typecheck
 * (`tsconfig.json`) y fuera del lint (`eslint.config.mjs`), y esa función decide
 * un `exit 1` de pre-deploy. El AR lo marcó como `MNR-2`: el script hermano ya
 * había recibido test por exactamente este motivo y éste no.
 *
 * POR QUÉ `createRequire` Y NO `import`: el script es CommonJS y se ejecuta con
 * `node scripts/validate-env.js`. `createRequire` lo carga con las mismas
 * semánticas que Node usa en producción; un `await import()` lo pasaría por el
 * interop de vite, que resuelve distinto que Node — y entonces el test estaría
 * midiendo el runner, no el runtime real.
 *
 * El `require` sólo es seguro porque el script tiene main-guard
 * (`if (require.main === module)`). Sin él, cargarlo acá correría `main()` y su
 * `process.exit()` mataría al runner: el primer assert de este archivo es,
 * justamente, que cargarlo no mata nada.
 */
import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const requireCjs = createRequire(import.meta.url)

interface ValidateEnvModule {
  checkDelegationTrio: (
    env?: Record<string, string | undefined>,
    log?: (line: string) => void,
  ) => boolean
  checkEnv: (keys: string[]) => { ok: string[]; missing: string[]; warnings: string[] }
  parseEnvExample: (path: string) => string[]
}

const validateEnv = requireCjs('../../../../scripts/validate-env.js') as ValidateEnvModule

/**
 * Junta todo lo impreso, sin colores ANSI, para poder assertar sobre el texto.
 * El regex se arma con `RegExp` y no como literal para no meter un byte de
 * control crudo en el fuente (regla `no-control-regex`).
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function collect(): { log: (line: string) => void; text: () => string } {
  const lines: string[] = []
  return {
    log: (line: string) => lines.push(String(line)),
    text: () => lines.join('\n').replace(ANSI, ''),
  }
}

describe('main-guard: requerir el script no ejecuta nada', () => {
  it('exporta la función y NO llamó a process.exit al cargarse', () => {
    // Si `main()` corriera al requerir, este archivo nunca llegaría a esta línea.
    expect(typeof validateEnv.checkDelegationTrio).toBe('function')
    expect(typeof validateEnv.checkEnv).toBe('function')
  })
})

describe('MNR-2 · checkDelegationTrio — las 3 ramas de la regla condicional (CD-1)', () => {
  it('flag vacío ⇒ NO bloquea, y dice que es un estado válido', () => {
    const out = collect()
    const blocked = validateEnv.checkDelegationTrio({}, out.log)
    expect(blocked).toBe(false)
    expect(out.text()).toContain('NO delega a wasiai-a2a')
    expect(out.text()).toContain('no un error')
    // El helper afirma que saca los colores: que sea falsable.
    expect(out.text()).not.toContain(String.fromCharCode(27))
  })

  it('flag con sólo espacios ⇒ se trata como vacío (no bloquea)', () => {
    const out = collect()
    expect(validateEnv.checkDelegationTrio({ V2_DELEGATE_TO_A2A: '   ' }, out.log)).toBe(false)
    expect(out.text()).toContain('NO delega')
  })

  it('flag + las 2 vars ⇒ coherente, no bloquea', () => {
    const out = collect()
    const blocked = validateEnv.checkDelegationTrio(
      {
        V2_DELEGATE_TO_A2A: 'compose,orchestrate',
        WASIAI_A2A_BASE_URL: 'https://a2a.example',
        WASIAI_V2_FORWARD_KEY: 'x'.repeat(32),
      },
      out.log,
    )
    expect(blocked).toBe(false)
    expect(out.text()).toContain('Delegación coherente')
  })

  it('flag sin WASIAI_V2_FORWARD_KEY ⇒ BLOQUEA y nombra la var que falta', () => {
    const out = collect()
    const blocked = validateEnv.checkDelegationTrio(
      { V2_DELEGATE_TO_A2A: 'compose', WASIAI_A2A_BASE_URL: 'https://a2a.example' },
      out.log,
    )
    expect(blocked).toBe(true)
    expect(out.text()).toContain('CD-1 VIOLADA')
    expect(out.text()).toContain('WASIAI_V2_FORWARD_KEY')
    expect(out.text()).not.toContain('falta(n): WASIAI_A2A_BASE_URL')
  })

  it('flag sin ninguna de las dos ⇒ BLOQUEA y nombra LAS DOS', () => {
    const out = collect()
    expect(validateEnv.checkDelegationTrio({ V2_DELEGATE_TO_A2A: 'compose' }, out.log)).toBe(true)
    expect(out.text()).toContain('WASIAI_A2A_BASE_URL')
    expect(out.text()).toContain('WASIAI_V2_FORWARD_KEY')
  })

  it('una var presente pero VACÍA cuenta como faltante', () => {
    const out = collect()
    const blocked = validateEnv.checkDelegationTrio(
      {
        V2_DELEGATE_TO_A2A: 'compose',
        WASIAI_A2A_BASE_URL: '',
        WASIAI_V2_FORWARD_KEY: 'x'.repeat(32),
      },
      out.log,
    )
    expect(blocked).toBe(true)
    expect(out.text()).toContain('WASIAI_A2A_BASE_URL')
  })

  it('el mensaje describe el efecto REAL (500 en toda ruta, no un 503 acotado)', () => {
    const out = collect()
    validateEnv.checkDelegationTrio({ V2_DELEGATE_TO_A2A: 'compose' }, out.log)
    const text = out.text()
    expect(text).toContain('500 en TODA ruta')
    expect(text).toContain('CARGA DE MÓDULO')
    // Los dos órdenes, porque el inverso es el que se olvida.
    expect(text).toContain('Orden de encendido')
    expect(text).toContain('Orden de apagado')
  })

  it('MNR-1: la cita del constraint apunta al .refine y al throw, no al docblock de otra var', () => {
    const out = collect()
    validateEnv.checkDelegationTrio({ V2_DELEGATE_TO_A2A: 'compose' }, out.log)
    const text = out.text()
    expect(text).toContain('src/lib/env.ts:88-99')
    expect(text).toContain(':106-110')
    // `:75-86` es el docblock de FACILITATOR_API_KEY y `:94` es un `{`.
    expect(text).not.toContain('75-86')
    expect(text).not.toContain(':94')
  })

  it('sin argumentos lee process.env (el camino que corre el CLI)', () => {
    // Se guardan y restauran LAS TRES: si el shell del que corre `npm test`
    // tuviera seteadas las otras dos, la rama incoherente no se alcanzaría y el
    // test daría verde sin haber medido nada.
    const KEYS = ['V2_DELEGATE_TO_A2A', 'WASIAI_A2A_BASE_URL', 'WASIAI_V2_FORWARD_KEY'] as const
    const original = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      for (const k of KEYS) delete process.env[k]
      expect(validateEnv.checkDelegationTrio()).toBe(false)
      process.env.V2_DELEGATE_TO_A2A = 'compose'
      expect(validateEnv.checkDelegationTrio()).toBe(true)
    } finally {
      spy.mockRestore()
      for (const k of KEYS) {
        if (original[k] === undefined) delete process.env[k]
        else process.env[k] = original[k]
      }
    }
  })
})
