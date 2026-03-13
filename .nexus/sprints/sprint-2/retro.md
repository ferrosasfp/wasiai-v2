# S6 Retrospectiva — Sprint 2 WasiAI

**Fecha:** 2026-03-13  
**SM:** San (NexusAgile v1.3)  
**Issues:** WAS-186, WAS-196, WAS-204, WAS-200, WAS-187  
**WAS-203:** Diferido (manual DNS — sin código)

---

## ¿Qué salió bien?

### ✅ Velocidad de entrega
Wave A (WAS-186 + WAS-196) y Wave B (WAS-204 + WAS-200) corrieron en paralelo. Sprint de 5 issues completado en ~2h de ejecución activa.

### ✅ Pipeline de review funcionó
Logic Auditor + Security Reviewer + QA Verifier en paralelo detectaron 4 bugs reales antes del merge. Todos fixeados en el mismo sprint. QA cerró con 24/24 ACs.

### ✅ Los fixes de review fueron quirúrgicos
Los 4 bugs bloqueantes (L10, BYPASS-001, SSRF-001, fallback_slug, preflight retry, AC-7) se fixearon en un solo commit sin necesidad de re-run de builders.

### ✅ WAS-204 timeout recovery
El builder de WAS-200 se cortó por timeout pero dejó el trabajo hecho en el working tree. El SM lo detectó, verificó, fixeó el build y commiteó sin perder nada.

---

## ¿Qué salió mal?

### ❌ Builder WAS-200 llegó al límite de tiempo
El subagente de WAS-200 tenía demasiadas waves (6) para el timeout configurado. Terminó sin commitear.  
**Root cause:** SDD con 6 waves es demasiado para un subagente de 5 min.

### ❌ Orden RETRY_MODE vs PREFLIGHT_SALDO invertido
El builder de WAS-204 puso el bloque RETRY_MODE *después* del preflight de saldo, causando que el balance check contara todos los steps (no solo los pendientes). Hubiera pasado a producción sin el review.  
**Root cause:** El SDD no especificó explícitamente el orden de los bloques.

### ❌ fallback_slug no cargaba desde DB
El builder asumió que `fallback_slug` estaría en `agentMap`, pero ese mapa solo contiene agentes pre-cargados como `agent_slug` estáticos. Un fallback a un slug no declarado siempre fallaba silenciosamente.  
**Root cause:** SDD no describió el caso de fallback_slug fuera del mapa.

### ❌ AC-7 (allowed_slugs en response) incumplido
El select de `agent-keys/me` ya incluía los campos, pero el return JSON no los exponía. El builder no leyó el return completo.  
**Root cause:** La instrucción "agregar al response" estaba en el SDD pero el builder terminó antes de llegar a esa wave.

---

## Action Items

| # | Tipo | Acción | Responsable |
|---|------|--------|-------------|
| A1 | Proceso | Limitar waves por Builder a máx 4 — SDDs con >4 waves se parten en 2 subagentes | SM |
| A2 | Proceso | El SDD debe incluir diagrama de orden de bloques en route handlers críticos | Spec Reviewer |
| A3 | Proceso | Builder debe leer el return/response completo de cada endpoint modificado antes de commitear | Builder |
| A4 | Deuda técnica | IDOR-001: mover ownership check a DB (WHERE clause en get_pipeline_for_retry) — WAS-206 | Sprint 3 |
| A5 | Deuda técnica | SSRF-002: allowlist de $ref solo locales (#...) — bloquear file:// y ftp:// | Sprint 3 |
| A6 | Deuda técnica | SCOPE-001: scope check explícito en fallback_slug path | Sprint 3 |
| A7 | Deuda técnica | WAS-203: Cloudflare proxy para app.wasiai.io | Sprint 3 / manual |

---

## Métricas del sprint

| Métrica | Valor |
|---------|-------|
| Issues completados | 5/5 (WAS-203 diferido) |
| ACs verificados | 24/24 |
| Migrations aplicadas | 4 (051-054) — testnet + mainnet |
| Bugs encontrados en review | 7 (4 bloqueantes fixeados, 3 deferred) |
| Commits del sprint | 8 (e997777..2a32734) |
| Linear issues creados | WAS-206 (IDOR-001) |

---

## Estado del repo al cierre

```
2a32734 fix(review): WAS-187 ambiguous_step + fallback_slug DB load; WAS-204 preflight pending only; WAS-186 AC-7
f6ceed5 fix(security): BYPASS-001 sandbox_enabled null; SSRF-001 $schema blocked
c44991b fix(WAS-200): input validation antes de deduct_sandbox_balance
9fab18e feat(WAS-187): dynamic discovery — capability + constraints + fallback_slug
172d21b feat(WAS-200): input schema + ajv meta-validate + SSRF block
95168e5 feat(WAS-204): compose retry — step_outputs + get_pipeline_for_retry + start_from_step
4eb6923 feat(WAS-196): sandbox opt-in/out por agente
e997777 feat(WAS-186): agent key scoping — allowed_slugs/categories + isAgentInScope
```

**Pendiente:** `git push` — a cargo de Fer.
