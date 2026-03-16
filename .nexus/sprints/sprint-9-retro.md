# Sprint 9 — Retrospectiva
**Fecha:** 2026-03-15
**Duración:** ~3h

## ¿Qué salió bien?
- Pipeline NexusAgil v1.3 funcionó limpio: Req Review → SDD → Spec Review → Builder → Auditor/QA
- Builders paralelos (Fase 1 + Fase 2) redujeron tiempo total significativamente
- Logic Auditor detectó el BLOQUEANTE real (storage mismatch input_example) antes de prod
- Deuda técnica cerrada al 100% (PipelineBuilder + PayToCallButton migrados)
- Pruebas integrales con key real validaron 7/7 agentes en producción
- 0 regresiones detectadas

## ¿Qué salió mal?
- Build roto en Vercel por eslint `--max-warnings 0` (TryIt.tsx useCallback) — detectado post-push
- Storage mismatch en WAS-206: Builder asumió columna directa, no existía en DB
- `input_example` del SELECT rompió todos los endpoints hasta que se revirtió
- 2 hotfixes adicionales post-build que no estaban en el plan

## ¿Qué mejorar?
- SDD debe especificar explícitamente si el campo existe en DB o requiere migración
- Build gate local antes de push: `npm run build` completo, no solo `tsc --noEmit`
- Builder debe verificar DB schema (doc/DB_SCHEMA.md) antes de cualquier SELECT nuevo

## Commits del sprint
```
19bec8e3b fix(DEUDA-02): handle Supabase error values + try/catch in agents API
f755ef4d9 feat(WAS-206): centralize buildExampleFromSchema + preview in form
30aa15fcd feat(DEUDA-01): expose resolved example_input in API
60130a1d2 chore(DEUDA-03): NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true in Vercel prod
6278a8567 feat(WAS-205): dynamic API fetch in Sandbox and TryIt
50ab16bf6 fix(WAS-205): useCallback for fetchAndSetPayload (eslint)
34b2b9600 fix(DEUDA-01/WAS-206): storage mismatch — use metadata JSONB
d7034f70d fix: remove input_example from SELECT, store/read via metadata
fba06a5b8 fix(DEUDA-02): CORS headers to /discover success response
0f840de05 fix(WAS-206): migrate PipelineBuilder + PayToCallButton to centralized util
147fdf542 fix(DEUDA-02): slim path error handling
```
Total: 11 commits

## Métricas
- Issues completados: 5/5 (WAS-205, WAS-206, DEUDA-01, DEUDA-02, DEUDA-03)
- Deuda técnica extra cerrada: 2 archivos (PipelineBuilder, PayToCallButton)
- Bugs post-deploy: 2 (eslint, storage mismatch) — ambos resueltos en <15min
- Cobertura de tests: 0 automáticos (backlog: DEUDA-06)
- Tiempo total deploy a prod funcional: ~45min desde primer push
