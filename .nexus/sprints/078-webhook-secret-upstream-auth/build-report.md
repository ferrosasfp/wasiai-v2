# Build Report — SDD #078: Webhook Secret & Upstream Auth

**Builder:** San (orquestador — sub-agente timedout, ejecutado directamente)
**Fecha:** 2026-03-19

---

## Wave execution

| Wave | Status | Build gate | Detalle |
|------|--------|------------|---------|
| Wave 0 — Re-validación | ✅ PASS | — | Todos los archivos existen. Fix no estaba implementado. |
| Wave 0 — Migración BD | ✅ DONE | `COUNT(*) WHERE webhook_secret IS NULL = 0` (pendiente aplicar en dev) | `070_webhook_secret.sql` creado |
| Wave 1 — Backend | ✅ DONE | `npx tsc --noEmit` ✅ | 9 archivos modificados |
| Wave 2 — Creator API | ✅ DONE | `npx tsc --noEmit` ✅ | 2 endpoints nuevos creados |
| Wave 3 — Frontend | ✅ DONE | `npx tsc --noEmit` ✅ | Widget + integración en dashboard |

---

## Commit

- **Hash:** `ab4e01a0e`
- **Message:** `improvement(078): webhook secret per-agent upstream auth`
- **Files changed:** 13 (9 modificados, 4 creados)
- **Insertions:** 298 | **Deletions:** 15

---

## Discrepancias encontradas

| Flujo | Discrepancia | Resolución |
|-------|-------------|------------|
| sandbox | `AgentRow` interface no tenía `webhook_secret` | Agregado al interface y al select |
| trial | `AgentRow` interface no existía — usa objeto directo del query | Agregado `webhook_secret` directamente al select |
| jobs | `AgentRow` interface no tenía `webhook_secret` | Agregado al interface y al select |

---

## Archivos creados

- `supabase/migrations/070_webhook_secret.sql`
- `src/app/api/creator/agents/[slug]/webhook-secret/route.ts`
- `src/app/api/creator/agents/[slug]/webhook-secret/rotate/route.ts`
- `src/app/[locale]/creator/dashboard/_components/WebhookSecretWidget.tsx`

## Archivos modificados

- `src/app/api/v1/agents/register/route.ts` — import randomBytes + webhook_secret en agentPayload
- `src/app/api/v1/mcp/route.ts` — firma callUpstreamMcp + headers auth
- `src/app/api/v1/models/[slug]/invoke/route.ts` — reemplazado x-internal-secret
- `src/app/api/v1/compose/route.ts` — select + interface + headers
- `src/app/api/v1/sandbox/invoke/[slug]/route.ts` — select + interface + headers
- `src/app/api/v1/agents/[slug]/trial/route.ts` — select + headers
- `src/app/api/v1/agents/[slug]/introspect/route.ts` — headers
- `src/app/api/v1/jobs/process/[id]/route.ts` — select + interface + headers
- `src/app/[locale]/creator/dashboard/page.tsx` — import + WebhookSecretWidget por agente

---

## Notas para Logic Auditor / QA

- La migración `070_webhook_secret.sql` aún no se ha aplicado en dev — requiere `supabase db push`
- El test end-to-end MCP (Wave 4) requiere que la migración esté aplicada en prod
- `health/route.ts` no fue tocado — confirmado sin auth (correcto por spec)
- `x-internal-secret` eliminado de los 5 flujos que lo tenían — ya no se usa en ningún archivo de scope
