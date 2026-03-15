# Test Report — WAS-214

### Tests escritos: 18
### Tests pasando: 18/18

| Test | Status |
|------|--------|
| AC1 happy path open (no AGENT_SIGNUP_KEY) | ✅ |
| AC1b happy path con x-signup-key correcto | ✅ |
| AC2 email duplicado → 409 | ✅ |
| AC3 x-signup-key ausente → 401 | ✅ |
| AC3 x-signup-key incorrecta → 401 | ✅ |
| AC4 rate limit 429 | ✅ |
| AC5 NO inserta en creator_profiles | ✅ |
| AC6 agent_keys con is_active/budget/spent correctos | ✅ |
| AC7 AGENT_SIGNUP_KEY vacío → endpoint abierto | ✅ |
| AC8 body sin email → 422 | ✅ |
| AC8 email malformado → 422 | ✅ |
| AC8 JSON inválido → 422 | ✅ |
| AC9 nombre auto-generado "agent-mybot" | ✅ |
| AC9 local-part >50 chars truncado | ✅ |
| AC10 rollback: insert falla → deleteUser llamado → 500 | ✅ |
| AC10 rollback: deleteUser también falla → log zombie → 500 | ✅ |
| AC11 Redis down 503 | ✅ |
| Auth check ANTES que rate limit | ✅ |

### Commit: `e5dbd3a`
