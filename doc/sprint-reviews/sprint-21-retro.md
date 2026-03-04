# Sprint 21 — Retrospectiva
**Fecha:** 2026-03-04  
**Sprint:** 21 — "Cleanup & Perfiles"

## Métricas

| Métrica | Valor |
|---------|-------|
| HUs completadas | 4/4 |
| Carry-over | 0 |
| Hotfixes | 3 de 4 HUs |
| AR BLOQUEANTE | 0 |
| AR MENOR | 0 |
| Tests inicio → fin | 190/200 → 200/200 |

## Qué funcionó bien
- Diagnóstico certero en todos los bugs — causa raíz correcta a la primera
- WAS-139: verificar con curl antes de tocar código ahorró tiempo (descartó RLS, apuntó al middleware)
- Reutilización de patrones existentes en WAS-137 (useFileUpload, CapabilitiesEditor)
- Pipeline Hotfix vs QUALITY aplicado correctamente según la naturaleza de cada HU

## Qué no funcionó
- WAS-138: tests desactualizados desde HU-3.3 — deuda de sincronización acumulada
- WAS-139: diagnóstico en backlog era incorrecto (decía "RLS", era middleware)

## Auto-Blindaje consolidado

### AB-014 — Tests se actualizan en el mismo sprint que el route
**Error:** HU-3.3 cambió la firma del route (use_trial RPC, free_trial_enabled) sin actualizar los tests → 10 tests fallando en Sprint 21.  
**Fix:** Los tests de un route deben actualizarse en la misma HU que cambia el contrato.  
**Regla:** Cuando F3 modifica un route existente, Dev debe revisar los tests existentes de ese route y actualizarlos antes del commit.

### AB-015 — Reproducir bug con evidencia antes del hotfix
**Error:** WAS-139 estaba documentado como "problema de RLS" pero era el middleware — diagnóstico previo sin verificación.  
**Fix:** Antes de iniciar cualquier hotfix, reproducir el bug con evidencia real (curl, log, screenshot).  
**Regla:** Paso 1 del Hotfix Pipeline es obligatorio — no asumir causa raíz sin evidencia.

## Velocidad
- Sprint 20: 5 HUs
- Sprint 21: 4 HUs  
- Tendencia: estable ✅

## Próximo sprint
**Sprint 22 — WAS-140:** Pagos agente→agente (Fuji, 1 hop) — XL, sprint completo dedicado.
