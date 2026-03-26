/**
 * Tests para WAS-296 — management key skip logic
 * Verifica que callerAlreadyHasKey y buildKeyResponse funcionen correctamente
 * según el authMethod.
 */
import { describe, it, expect } from 'vitest'

// ── Lógica extraída de register/route.ts ──────────────────────────────────
function shouldGenerateManagementKey(authMethod: string): boolean {
  const callerAlreadyHasKey = authMethod === 'jwt' || authMethod === 'agent_key'
  return !callerAlreadyHasKey
}

function buildKeyResponse(callerAlreadyHasKey: boolean, managementKey: string | null) {
  return callerAlreadyHasKey
    ? { use_existing_key: true, management_key_message: 'Use your existing x-agent-key to manage this agent' }
    : { management_key: managementKey, management_key_warning: managementKey ? null : 'Management key could not be issued. Contact support@wasiai.io' }
}

// ─────────────────────────────────────────────────────────────────────────────

describe('WAS-296 — management key skip logic', () => {

  describe('shouldGenerateManagementKey', () => {
    it('jwt → NO genera management key', () => {
      expect(shouldGenerateManagementKey('jwt')).toBe(false)
    })

    it('agent_key → NO genera management key', () => {
      expect(shouldGenerateManagementKey('agent_key')).toBe(false)
    })

    it('open → SÍ genera management key', () => {
      expect(shouldGenerateManagementKey('open')).toBe(true)
    })

    it('open_key → SÍ genera management key', () => {
      expect(shouldGenerateManagementKey('open_key')).toBe(true)
    })
  })

  describe('buildKeyResponse — callerAlreadyHasKey = true (jwt / agent_key)', () => {
    it('retorna use_existing_key: true y management_key_message', () => {
      const res = buildKeyResponse(true, null)
      expect(res).toHaveProperty('use_existing_key', true)
      expect(res).toHaveProperty('management_key_message', 'Use your existing x-agent-key to manage this agent')
      expect(res).not.toHaveProperty('management_key')
    })
  })

  describe('buildKeyResponse — callerAlreadyHasKey = false (open / open_key)', () => {
    it('retorna management_key cuando se genera correctamente', () => {
      const res = buildKeyResponse(false, 'wai_test_key_abc123')
      expect(res).toHaveProperty('management_key', 'wai_test_key_abc123')
      expect(res).toHaveProperty('management_key_warning', null)
      expect(res).not.toHaveProperty('use_existing_key')
    })

    it('retorna management_key_warning cuando no se pudo generar', () => {
      const res = buildKeyResponse(false, null)
      expect(res).toHaveProperty('management_key', null)
      expect(res).toHaveProperty('management_key_warning', 'Management key could not be issued. Contact support@wasiai.io')
    })
  })
})
