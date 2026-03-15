# Build Report — SDD #075

### Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 — Pre-flight | ✅ PASS | ✅ clean | `callId` no expuesto en `buildResponse`; tabla `disputes` no existe; TSC clean |
| Wave 1 — Migration | ✅ PASS | — | `supabase/migrations/062_disputes.sql` creado con schema completo, RLS service_only, índices |
| Wave 2 — invoke call_id | ✅ PASS | ✅ clean | Error branch Route A captura `errCallId`; `buildResponse` acepta `callId` param; ambos call sites pasan `callId`; `meta.call_id` expuesto |
| Wave 3 — Dispute endpoint | ✅ PASS | ✅ clean | `POST /api/v1/calls/[call_id]/dispute/route.ts` creado; auth x-api-key; validación reason enum; ownership check; 409 on unique constraint |
| Wave 4 — Admin endpoints | ✅ PASS | ✅ clean | `GET /api/admin/disputes` con filtros status/agent_slug; `PATCH /api/admin/disputes/[id]` con status+resolution_note+resolved_at |
| Wave 5 — Dashboard | ✅ PASS | ✅ clean | Tab "Disputes" en `creator/dashboard/page.tsx`; lista read-only con agent, call_id, reason, status, date |

### Commit
- Hash: `e299ab0d7`
- Message: `feat(WAS-189): dispute resolution — endpoint + admin + dashboard + call_id in invoke`
- Files changed: 6

### Archivos creados/modificados
| Archivo | Acción |
|---------|--------|
| `supabase/migrations/062_disputes.sql` | Creado |
| `src/app/api/v1/calls/[call_id]/dispute/route.ts` | Creado |
| `src/app/api/admin/disputes/route.ts` | Creado |
| `src/app/api/admin/disputes/[id]/route.ts` | Creado |
| `src/app/api/v1/models/[slug]/invoke/route.ts` | Modificado |
| `src/app/[locale]/creator/dashboard/page.tsx` | Modificado |

### Discrepancias encontradas
- **Wave 4 split en SDD vs implementación:** El SDD menciona `GET+PATCH /api/admin/disputes/route.ts` pero en las notas críticas especifica separar PATCH en `[id]/route.ts`. Se implementó según las notas críticas (separado), que es la forma correcta para Next.js dynamic routes.
- **cast `unknown`:** El tipo de retorno de Supabase para el join `agent:agents(...)` devuelve array `{ name, slug }[]` en lugar de objeto single. Se usó `as unknown as DisputeRow[]` para evitar el error TS2352, consistente con el patrón usado en el mismo archivo para `CallRow`.

### Notas
- La migration `062_disputes.sql` NO fue aplicada a ninguna BD (solo archivo SQL, per reglas).
- No se hizo `git push` (solo commit local, per reglas).
- TSC limpio en todas las waves (0 errores, 0 warnings).
- `createServiceClient()` usado en todos los endpoints que escriben a `disputes`.
- Admin auth sigue exactamente el patrón de `/api/admin/status/route.ts`.
