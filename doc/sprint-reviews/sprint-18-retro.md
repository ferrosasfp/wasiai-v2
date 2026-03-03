# Sprint 18 Retrospectiva — "Calidad y deuda técnica S17"

**Fecha:** 2026-03-03  
**Facilitador:** San (Scrum Master)  
**Participantes:** Fer (PO/Dev), San (SM/Analyst/Architect/QA)  
**Resultado:** 11/11 SP ✅ — Sprint cerrado con 4 incidentes gestionados

---

## ✅ Qué salió bien

1. **Velocidad excepcional:** 11 SP en ~2h de sesión nocturna. El flujo NexusAgil QUALITY funcionó sin fricción — cada HU pasó por SDD → Story File → Dev → AR → CR → QA sin retrasos entre fases.

2. **Adversarial Review atrapó bugs reales:** El AR detectó el test duplicado en `language-switcher.spec.ts` y el issue de ESLint con `require()` antes de que llegaran a producción. El proceso de revisión adversarial justificó su overhead.

3. **Incidente del PAT resuelto sin pérdida de trabajo:** El bloqueo por `workflow` scope se identificó rápido (error de GitHub explícito), Fer lo resolvió en minutos y el pipeline quedó operativo sin retrabajo de código.

4. **Deuda técnica S17 cerrada al 100%:** Las 3 HUs de deuda crítica (WAS-118, WAS-119, WAS-120) se completaron íntegras. No se pospuso nada. El sprint cumplió exactamente su objetivo declarado en planning.

5. **Story Files autocontenidos funcionaron:** Cada Dev pudo implementar leyendo únicamente su story file. No hubo consultas de "¿cómo se llama el método X?" ni revisión de código ajeno durante implementación.

6. **CEI pattern en contrato sin fricción:** La implementación de `refundExpired()` con Checks-Effects-Interactions quedó limpia al primer intento. Sin vulnerabilidades de reentrancy detectadas en AR.

---

## 🔧 Qué mejorar

### 1. 🚨 Rol San colapsado: SM no codea
**Incidente:** San asumió trabajo de Dev directamente al inicio del sprint en lugar de mantenerse en rol SM/Analyst/Architect.  
**Impacto:** Viola la separación de roles de NexusAgil. Si SM codea, nadie supervisa el proceso — se pierde el punto ciego que justifica tener roles separados.  
**Detección:** Fer lo identificó y corrigió inmediatamente.  
**Causa raíz:** En sprints intensos de deuda técnica, la urgencia crea presión para "saltar" al código. San cedió a esa presión.  
**Acción:** Ver Auto-Blindajes abajo.

### 2. PAT scope no verificado antes del sprint
**Incidente:** El PAT de GitHub no tenía el scope `workflow` necesario para pushear `.github/workflows/`.  
**Impacto:** Bloqueó WAS-120 durante varios minutos hasta que Fer agregó el scope.  
**Causa raíz:** No existe checklist de prerequisitos de infraestructura antes de iniciar HUs que requieren permisos nuevos.  
**Acción:** Agregar al pre-deploy checklist (y al planning) una verificación de scopes/permisos cuando una HU toca CI/CD o secrets.

### 3. Tests Playwright sin cobertura de flujos de pago
**Observación:** Los E2E del Sprint 18 cubren navegación y language-switcher, pero los flujos críticos (crear escrow, refund, dispute) no tienen cobertura automatizada aún.  
**Riesgo:** Pipeline CI verde no equivale a contratos seguros — pueden pasar tests E2E con contrato roto.  
**Acción:** Sprint 19 debe incluir tests E2E para al menos el flujo happy-path de escrow en testnet.

---

## 🏁 Auto-Blindajes para METHODOLOGY.md

Los siguientes blindajes deben agregarse a la metodología NexusAgil:

### AB-007: San no toca código sin SPEC_APPROVED
```
⛔ San (SM/Analyst/Architect) NO genera ni modifica código de aplicación
   hasta que exista un story file aprobado (SPEC_APPROVED) Y el rol Dev
   haya sido explícitamente activado para esa HU.
   Viola este blindaje = Fer detiene la sesión y San hace un reset de rol.
```

### AB-008: Verificar prerequisitos de infraestructura en planning
```
⚠️  En F0 (Contexto), para HUs que involucren CI/CD, secrets, o servicios
    externos: verificar que los tokens/scopes/APIs necesarios existen y
    tienen los permisos correctos ANTES de comenzar la implementación.
    Si falta algún prerequisito → agregarlo al backlog como tarea cero.
```

### AB-009: CI verde ≠ seguridad de contrato
```
📋 Un pipeline E2E verde no valida la lógica del contrato. Para HUs de
   smart contracts, la validación primaria es `forge test` con cobertura
   de los flujos críticos. Los E2E de Playwright son complementarios,
   no sustitutos de los tests de contrato.
```

---

## 🚀 Preview Sprint 19 — "Mainnet Launch"

Sprint 18 dejó WasiAI v2 en estado óptimo para el siguiente hito. Sprint 19 apunta a:

### Candidatos HU (por priorizar en planning)
| Candidato | Descripción | SP est. |
|-----------|-------------|---------|
| WAS-123 | Deploy WasiEscrow a mainnet (Polygon/Base) | 5 |
| WAS-124 | E2E tests flujos escrow (create + refund + dispute) | 3 |
| WAS-125 | Dashboard transacciones usuario (historial escrows) | 3 |
| WAS-126 | Notificaciones push: escrow expirado / disputa abierta | 3 |
| WAS-127 | Audit report pre-mainnet (checklist seguridad) | 2 |

### Objetivo del sprint
**"Primer escrow real en mainnet con usuario real."**

La infraestructura CI/CD, el contrato trustless, el pre-deploy checklist y la calidad del frontend construidos en S18 convergen en un solo milestone: poner WasiAI en manos de usuarios reales con dinero real.

### Condición de entrada
- [ ] Fer confirma red objetivo (Polygon PoS vs Base)  
- [ ] Budget gas disponible para deploy + testing en mainnet  
- [ ] Definir si se requiere auditoría externa antes del launch  

---

_Retrospectiva generada por San (SM) — Sprint 18 cerrado el 2026-03-03_
