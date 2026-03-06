# Work Item #035 — WAS-132: Eliminar recordInvocation() del hot path

| Campo | Valor |
|-------|-------|
| **#** | 035 |
| **HU** | WAS-132 |
| **Tipo** | improvement |
| **SDD_MODE** | full |
| **Objetivo** | Eliminar recordInvocation() on-chain del hot path. Supabase agent_calls es la fuente de verdad — no se necesita registro duplicado on-chain por cada llamada. |
| **Scope IN** | invoke/route.ts · pendingRecordings.ts · cron/retry-recordings/ · admin/status/route.ts · vercel.json |
| **Scope OUT** | agent_calls (Supabase), settleKeyBatch, flujo pagos x402, flujo Agent Key, marketplaceClient.ts |
| **Gate 1** | HU_APPROVED — 2026-03-03 |
| **Gate 2** | SPEC_APPROVED — 2026-03-03 |

## Acceptance Criteria (EARS)

- AC1: WHEN una invocación x402 es exitosa, THE sistema SHALL registrar en Supabase agent_calls sin llamar recordInvocationOnChain()
- AC2: WHEN una invocación Agent Key es exitosa, THE comportamiento SHALL ser idéntico al actual
- AC3: WHEN el admin consulta /api/admin/status, THE campo pendingRecordings SHALL ser eliminado de la respuesta
- AC4: IF existen registros en pending_recordings en Supabase, THE cron retry-recordings SHALL ser desactivado
- AC5 (Adversary): BEFORE deploy, THE tabla pending_recordings SHALL estar vacía o sus registros documentados como legacy sin impacto en pagos
