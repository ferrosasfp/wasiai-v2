# Report — HU-020 / WAS-75: Sandbox Gratuito para Builders (Fuji + Créditos)

**Fecha:** 2026-03-02  
**Sprint:** 15 | **Modo:** QUALITY  
**Issue Linear:** WAS-75

---

## Archivos Creados/Modificados

| Archivo | Acción |
|---------|--------|
| `src/app/api/v1/agents/[slug]/call/route.ts` | Modificado — lógica sandbox credits |
| `supabase/migrations/*_sandbox_credits.sql` | Creado — tabla + funciones SQL |
| `src/lib/sandbox.ts` | Creado — helpers deducción + reembolso |

---

## ACs Status

| AC | Descripción | Estado |
|----|-------------|--------|
| AC-01 | Deducción atómica + respuesta 200 | ✅ PASS |
| AC-02 | Crear fila sandbox_credits si no existe | ✅ PASS |
| AC-03 | 402 si balance insuficiente | ✅ PASS |
| AC-04 | Rate limit 10 llamadas/hora → 429 | ✅ PASS |
| AC-05 | Reembolso + 422 si agente falla | ✅ PASS |
| AC-06 | agent_calls con payment_type='sandbox' + is_trial=true | ✅ PASS |
| AC-07 | Migración agrega payment_type DEFAULT 'x402' | ✅ PASS |
| AC-08 | 401 si no autenticado | ✅ PASS |
| AC-09 | 404 si slug no existe o agente inactivo | ✅ PASS |

**Score: 9/9 PASS**

---

## AR Summary

| Bloqueante | Descripción | Resolución |
|------------|-------------|------------|
| B-01 | Migración SQL no idempotente (sin `CREATE OR REPLACE`) | Corregido |
| B-02 | Key Redis imprecisa (sin user_id scope) | Corregido — key incluye user_id |

2 BLOQUEANTEs resueltos. QA aprobó funcionalidad completa.

---

## Build Final

```
npx tsc --noEmit → ✅ 0 errores
QA: 9/9 PASS
```

**Estado: DONE ✅**
