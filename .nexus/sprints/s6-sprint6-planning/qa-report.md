# QA Report — Sprint 6 WasiAI
**NexusAgil v1.3 | Fecha:** 2026-03-14 | **Estado:** HEAD local (sin push)

==========================================
SPRINT 6 — QA VERIFICATION
==========================================

=== S6-03: WAS-132 ===
  ✅ `supabase/migrations/060_nonce_agent_calls.sql` existe con `ADD COLUMN IF NOT EXISTS nonce TEXT`
  ✅ Índice único parcial `idx_agent_calls_nonce_unique` WHERE nonce IS NOT NULL
  ✅ `logCall()` en `invoke/route.ts` NO fue modificado — nonce queda nullable (columna no en el insert)
  ✅ `docs/architecture/payments.md` existe y menciona WAS-132 extensamente

=== S6-A3: min_performance ===
  ✅ `src/app/api/v1/agents/route.ts` lee `min_performance` del querystring (`minPerfRaw`)
  ✅ Valida NaN, <0, >100 → retorna 400
  ✅ String vacío `""` → ignorado (trim check + null check previenen que pase como 0)
  ✅ Se pasa a query Supabase: `query.gte('performance_score', minPerformance)` (línea ~176)
  ✅ `min_reputation` corregido: filtra sobre `reputation_score` (no `performance_score`) en `query.gte('reputation_score', val)`

=== S6-01: settlement_failures ===
  ✅ `supabase/migrations/059_settlement_failures.sql` existe con tabla completa + 2 índices
  ✅ RLS habilitado con política `settlement_failures_service_only` que bloquea TO authenticated, anon USING (false)
  ✅ Route B en `invoke/route.ts`: insert solo cuando `settlement.settled && result.status !== 'success'`
  ✅ `.then((res) => { if (res.error) { logger.error(...) } else { logger.warn(...) } })` — verifica `res.error` antes de loguear éxito
  ✅ `/api/admin/status` incluye `settlement_failures_pending` en raíz con fallback `.then((r) => r.error ? { count: 0 } : r)`

=== S6-02: observabilidad x402 ===
  ✅ `invoke/route.ts` tiene `[x402] probe` log antes del 402 response (línea ~417)
  ✅ `invoke/route.ts` tiene `[x402] settle_result` log con `latency_ms` (dos casos: error y success, líneas ~427 y ~438)
  ✅ `invoke/route.ts` tiene `[x402] upstream_result` log con `status`, `latency_ms`, `charged` (línea ~464)
  ✅ `admin/status` incluye `x402_health` con `settlement_failures_pending`, `settlement_failures_24h`, `total_invocations_x402_24h`, `alert`
  ✅ `avaxBalance` NO está duplicado en x402_health — solo aparece en raíz del response

=== Auth admin/status ===
  ✅ `admin/status/route.ts` verifica `Authorization: Bearer <ADMIN_SECRET>` (líneas 16-19)
  ✅ Retorna 401 `{ error: 'Unauthorized' }` si no autorizado o si ADMIN_SECRET no está configurado

=== Build ===
  ✅ exit code 0 — build completado sin errores

RESULT: 21/21 PASS

---
*Todos los checks del Sprint 6 pasaron. No hay fallas. Listo para push cuando corresponda.*
