# Sprint 19 Retrospectiva — "Security Hardening"

**Fecha:** 2026-03-03  
**Facilitador:** San (Scrum Master)  
**Participantes:** Fer (PO/Dev), San (SM/Analyst/Architect/QA)  
**Resultado:** 7/7 HUs ✅ — Sprint cerrado limpio, 0 incidentes

---

## Resumen del Sprint

| Métrica | Valor |
|---------|-------|
| HUs completadas | 7 |
| HUs carry-over | 0 |
| HUs abortadas | 0 |
| Errores Auto-Blindaje | 0 |
| Hallazgos AR BLOQUEANTE | 0 |
| Hallazgos AR MENOR | 0 |
| Incidentes durante sprint | 0 |
| Duración | ~2h |

---

## ✅ Qué salió bien

### 1. Separar FAST de QUALITY fue la decisión correcta
6 de 7 HUs fueron FAST fixes. Al no forzarlos por el pipeline QUALITY completo (SDD → Story File → Adversarial Review → Code Review → QA), se ejecutaron en minutos cada uno. La única HU que realmente justificaba QUALITY (NA-004, lógica de fallback con estado, tests nuevos) pasó por el flujo completo. La mezcla de modos fue la clave de velocidad sin sacrificar rigor donde importaba.

### 2. Priorización por severidad funcionó perfectamente
Los dos findings HIGH se cerraron primero (WAS-128 y WAS-129). Si la sesión hubiera necesitado cortarse a mitad, el codebase hubiera quedado con los riesgos más críticos ya cerrados. La cola P1→P2→...→P7 del planning se respetó en orden.

### 3. QUALITY para NA-004 produjo cobertura real
6 tests nuevos en `ratelimit-fallback.test.ts`. El pipeline completo forzó pensar en todos los escenarios de fallo (timeout, error de red, Redis no disponible) que un FAST fix hubiera dejado sin cubrir. El overhead del proceso se justificó con evidencia concreta.

### 4. 0 incidentes — sprint más limpio hasta la fecha
Sin bloqueos de infraestructura, sin regresiones, sin conflictos de merge, sin scopes faltantes. El pre-deploy checklist del Sprint 18 (WAS-119) hizo su trabajo.

### 5. Decisión de diferir NA-003 Parte B fue correcta y documentada
Crear el Safe multisig en testnet sin usuarios reales no tiene valor. La decisión de diferirlo con justificación técnica explícita (no es deuda, es condición de entrada Mainnet) evitó trabajo prematuro y está trazable en el review.

### 6. `verifyInternalSecret.ts` como helper centralizado
WAS-130 no solo protegió los 5 endpoints — los protegió con un único punto de verdad. Si la lógica de autenticación cambia, se cambia en un lugar. El patrón DRY aplicado a seguridad.

---

## 🔧 Qué mejorar

### 1. Asignar NNNs a los FAST fixes antes de ejecutar
WAS-128 a WAS-133 no tienen NNN asignado (excepto WAS-134 que sí tiene NNN-034). Los FAST fixes se ejecutaron sin número de artefacto formal. No bloqueó nada, pero si se necesita rastrear un artefacto específico del sprint en `_INDEX.md`, los NNNs faltantes crean un hueco.  
**Acción:** En planning de sprints con múltiples FAST fixes, pre-asignar rango de NNNs aunque no se genere SDD formal.

### 2. NA-006 (creator_public_profiles) quedó fuera del sprint
Estaba como stretch goal en el planning. Con 7/7 HUs completadas en ~2h, había capacidad. No fue un error — la priorización de seguridad fue correcta — pero se podría haber capturado como "oportunidad no aprovechada".  
**Acción:** Si el sprint cierra con tiempo restante estimado, SM propone activamente el stretch goal en lugar de esperar.

---

## 🏁 Auto-Blindajes para METHODOLOGY.md

### AB-010: FAST vs QUALITY — criterio de selección de modo
```
⚡ En sprints con múltiples findings de audit o fixes pequeños independientes,
   separar explícitamente los FAST fixes del pipeline QUALITY:
   
   FAST si:
   - ≤ 3 archivos modificados
   - Sin lógica nueva (solo corrección de existente)
   - Sin nuevos tests requeridos
   - Sin cambios de schema ni contratos
   
   QUALITY si:
   - Lógica nueva con estados/fallbacks
   - Tests nuevos requeridos como parte del fix
   - Comportamiento en producción cambia de forma no trivial
   - Contratos afectados
   
   Mezclar modos en el mismo sprint es válido y eficiente.
   NO forzar QUALITY en FAST fixes por "consistencia".
```

### AB-011: Priorización por severidad en sprints de hardening
```
📋 En sprints de security hardening o bug-fix masivo, ejecutar siempre
   en orden de severidad descendente:
   HIGH → MEDIUM → LOW → INFO
   
   Si la sesión se corta antes de completar, el codebase queda en el
   estado más seguro posible con el trabajo realizado.
   
   Nunca reordenar por conveniencia técnica si hay findings HIGH pendientes.
```

---

## 🚀 Preview Sprint 20 — "Mainnet Deploy"

Sprint 19 dejó WasiAI v2 hardened y listo para el hito principal. Sprint 20 cierra el ciclo con el deploy a Mainnet.

### Condición de entrada (BLOQUEANTE)
- [ ] **Safe multisig 2-de-3 configurado** (NA-003 Parte B) — sin esto no hay `transferOwnership` al Safe y el contrato queda con owner en EOA en Mainnet. Inaceptable para producción.

### Candidatos HU

| Candidato | Descripción | Finding/Origen | Prioridad |
|-----------|-------------|----------------|-----------|
| WAS-133 Parte B | Safe multisig 2-de-3 + `transferOwnership` al Safe | NA-003 Parte B | P1 (condición entrada) |
| WAS-135 | Deploy WasiEscrow + WasiFeeManager a Mainnet | S18 objetivo + S19 hardening | P2 |
| WAS-136 | Vista `creator_public_profiles` | NA-006 | P3 (stretch S19 → carry S20) |

### Objetivo del sprint
**"Primer contrato en Mainnet con ownership en Safe multisig."**

Todo el trabajo de los últimos 3 sprints — CI/CD (S18), contrato trustless (S18), security hardening (S19) — converge aquí. El Safe multisig es el último requisito antes de exponer WasiAI v2 a usuarios reales con dinero real.

### Riesgos identificados
- Gas fees en Mainnet pueden requerir presupuesto explícito (Fer confirma en planning)
- Configurar el Safe requiere múltiples wallets/firmantes — coordinar antes del sprint
- Si NA-006 entra al sprint, evaluar si va QUALITY o puede ser FAST (probablemente QUALITY por UI nueva)

---

_Retrospectiva generada por San (SM) — Sprint 19 cerrado el 2026-03-03_
