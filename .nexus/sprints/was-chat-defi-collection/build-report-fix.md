## Build Report Fix — SDD #092

### Correcciones aplicadas
| Fix | Status | Detalle |
|-----|--------|---------|
| F1 — Filtrar agentes inactivos | ✅ DONE | Añadido `.eq('agents.status', 'active')` al query Supabase + select incluye `status` e `input_schema` |
| F2 — Validar input_schema | ✅ DONE | Interface `CollectionAgent` actualizada con `status` e `input_schema`; `extractAgent` incluye guards de status y schema |
| F3 — TTL a 60s | ✅ DONE | `CACHE_TTL_MS = 60_000` (antes: `5 * 60 * 1000`) |
| F4 — Schema props en prompt | ✅ DONE | `buildPlannerPrompt` ahora incluye propiedades del `input_schema` por agente |

### Commit
- Hash: `369de6e6f`
- Message: `fix(chat): active-only filter, input_schema guard, TTL 60s, prompt with schema props — SDD #092`
- Files changed: 1

### TSC
PASS
