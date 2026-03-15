## Logic Audit — SDD #214 (commit 6433a65)

### AC Trazabilidad

| AC | Implementado | Archivo:línea | Status |
|----|-------------|---------------|--------|
| AC1 — HTTP 201 + `wasi_xxx` key | Parcial | `route.ts:63` — retorna `{ agent_key: raw }` con status 201 | ⚠️ PARCIAL — `generateApiKey()` no está en el diff; no se puede verificar que `raw` tenga prefijo `wasi_` |
| AC2 — HTTP 409 email duplicado | Sí | `route.ts:47-49` | ⚠️ FRÁGIL — depende de string matching contra mensaje de Supabase |
| AC3 — HTTP 401 cuando key inválida/ausente | Sí | `route.ts:20-26` | ✅ |
| AC4 — HTTP 429 rate limit >5/hora | Sí | `route.ts:15-17` + `ratelimit.ts` slidingWindow(5) | ✅ |
| AC5 — `creator_profile` vía trigger DB | Sí (by design) | No código explícito — depende de trigger | ✅ |
| AC6 — key hasheada, `is_active: true`, `budget_usdc: 0`, `spent_usdc: 0` | Sí | `route.ts:55-63` | ✅ |
| AC7 — endpoint abierto si `AGENT_SIGNUP_KEY` no seteada/vacía | Sí | `route.ts:20` — `if (signupKey && signupKey !== '')` | ✅ |
| AC8 — HTTP 422 email inválido | Sí | `route.ts:33-37` | ✅ |
| AC9 — `name = "agent-{email-local-part}"` | Sí | `route.ts:53-54` (con slice 50 chars) | ✅ |
| AC10 — HTTP 500 + delete user si key insert falla | Parcial | `route.ts:65-69` | ⚠️ PARCIAL — deleteUser es fire-and-forget sin manejo de error |
| AC11 — HTTP 503 si Redis no disponible | Sí | `ratelimit.ts:checkRateLimit` catch block | ✅ |

---

### Findings

| # | Severidad | Categoría | Detalle | Archivo:línea |
|---|-----------|-----------|---------|---------------|
| F1 | 🔴 HIGH | Order of Operations | **Rate limit se consume ANTES del auth check.** Un atacante sin `x-signup-key` válido puede igualmente quemar las 5 ranuras por IP de usuarios legítimos. El auth check debe ejecutarse primero para rechazar requests no autenticados sin tocar el rate limiter. | `route.ts:14-26` |
| F2 | 🟡 MEDIUM | Error Handling | **`deleteUser` es fire-and-forget.** En AC10, si el insert de `agent_keys` falla y el `deleteUser` también falla, el usuario queda como zombie en Supabase Auth sin `agent_key` asociado. El resultado es inconsistencia de datos silenciosa. Se debe awaitar y loguear el error del cleanup (o re-intentar). | `route.ts:66` |
| F3 | 🟡 MEDIUM | Fragile Detection | **AC2 usa string matching frágil** (`createError.message?.includes('User already registered')`). Si Supabase cambia el wording del error (e.g. versión futura), la condición falla silenciosamente y retorna HTTP 500 en lugar de 409. Preferible verificar `createError.code` o status code estructurado si Supabase lo expone. | `route.ts:47` |
| F4 | 🟡 MEDIUM | Unverifiable AC | **`generateApiKey()` no está en el diff.** AC1 exige que la key tenga prefijo `wasi_xxx`. Imposible confirmar sin ver la implementación de `agent-keys.service.ts`. Si la función no genera el prefijo correcto, AC1 falla silenciosamente en producción. | `route.ts:52` |
| F5 | 🟢 LOW | Concurrency | **Race condition teórica en signup simultáneo.** Dos requests con el mismo email pueden pasar el rate limit y llegar a `createUser` casi simultáneamente. En la práctica Supabase maneja la unicidad a nivel DB (constraint), por lo que uno recibirá el error de duplicado. El handling de AC2 cubre este caso, pero solo si el error message matching (F3) es correcto. | `route.ts:42-50` |
| F6 | 🟢 LOW | Response Leakage | **En error genérico de `createUser`, se retorna `createError.message` directo al cliente** (`{ error: createError.message }`). Mensajes internos de Supabase podrían exponer información sensible de infraestructura. Preferible mensaje genérico + logging server-side. | `route.ts:50` |

---

### Veredicto

**REQUIERE CORRECCIÓN**

**Crítico a resolver antes de merge:**
1. **F1** — Invertir orden: auth check → rate limit check (impacto en seguridad real)
2. **F2** — Manejar error de `deleteUser` cleanup (integridad de datos)
3. **F4** — Verificar que `generateApiKey()` retorna clave con prefijo `wasi_` (AC1 no verificable sin esto)

**Recomendado resolver:**
4. **F3** — Reemplazar string matching por comparación de código de error estructurado
5. **F6** — Sanitizar mensajes de error expuestos al cliente

---

*Auditado por: Logic Auditor (NexusAgil v1.3) — 2026-03-14*
