# Sprint 3 — Retrospectiva

**Sprint:** 3  
**Fecha:** 2026-03-13/14  
**Equipo:** San (SM/Orquestador) + Builders subagentes  
**Issues:** WAS-206 (IDOR-001), WAS-202 (output schema), SSRF-002, SCOPE-001  
**Head final:** `f9f6189`

---

## ✅ Qué salió bien

1. **Paralelismo efectivo** — SSRF-002, WAS-206 y WAS-202 corrieron en paralelo después de SCOPE-001 secuencial. Sin conflictos de merge.

2. **Security Reviewer encontró 2 blockers reales** (SEC-01, SEC-02) que el Builder no detectó. El pipeline de revisión funcionó como debe.

3. **Pruebas integrales end-to-end** — sandbox + on-chain con agente real, validación de IDOR en RPC directo, SSRF 10/10 protocolos testeados.

4. **Fer encontró bugs reales en UI** durante la sesión de testing manual:
   - Textarea con rebote (JSON raw state)
   - Close key sin feedback
   - Placeholder vacío en schema tipo string
   Todos corregidos en tiempo real.

5. **CopyableOutput** — componente reutilizable bien aplicado en 4 surfaces distintas.

---

## ❌ Qué salió mal

1. **Builder WAS-202 metió claves i18n en namespace `editAgent` en vez de `publish`** — causó error de hydration visible en producción. Detectado solo en testing manual de Fer.

2. **Builder no agregó mensajes de error visibles para schema inválido en EditAgentForm** — el servidor retornaba 422 pero el UI no mostraba nada. Silencioso para el usuario.

3. **Builder no agregó `output_schema` a `AvailableAgent` en PipelineBuilder** — placeholder dinámico no llegó al pipeline sin intervención post-sprint.

4. **Close key sin validación de wallet** — `handleClose` asumía wallet conectada cuando `balance > 0`, crasheaba silenciosamente si no estaba lista. Falta de defensive programming.

5. **`address.toLowerCase()` sin null check** — crash silencioso que hacía aparecer el botón Close como deshabilitado cuando no había wallet conectada.

6. **Namespace i18n inconsistente** — algunos strings nuevos pusheados a `editAgent`, otros a `publish`, sin criterio uniforme. Requería corrección manual post-build.

---

## 🔧 Acciones para Sprint 4

| # | Acción | Responsable |
|---|--------|-------------|
| A1 | Builder debe verificar que todos los errores del servidor tengan representación visual en UI antes de commitear | Builder role |
| A2 | Builder debe agregar null checks en cualquier acceso a `address`, `chain`, `wallet` — estos son undefined en SSR | Builder role |
| A3 | SDD debe especificar el namespace i18n correcto para cada clave nueva (no solo el key name) | SDD template |
| A4 | Builder debe propagar campos nuevos (`input_schema`, `output_schema`) a todos los interfaces TypeScript relacionados desde Wave 0 | Builder role |
| A5 | QA Verifier debe incluir check: "¿Todos los errores de API tienen representación en UI?" como AC implícito | QA Verifier role |

---

## 📊 Métricas

| Métrica | Valor |
|---------|-------|
| Issues planificados | 4 |
| Issues entregados | 4 ✅ |
| Security findings | 2 (SEC-01 HIGH, SEC-02 MEDIUM) — ambos resueltos |
| Bugs UI post-QA | 6 — todos resueltos en sesión |
| Commits Sprint 3 | 15 (6 sprint + 9 post-QA fixes) |
| Tests integrales | 12/12 ✅ |
| Inferencias on-chain validadas | 2 (sandbox + PayToCall) |

---

## HEAD final

```
f9f6189 fix(agent-keys): invalidar cache después de crear/cerrar/depositar/retirar key
d238906 fix(close-key): permitir cerrar sin wallet cuando balance=0
c4916cf fix(close-key): validar wallet conectada y red antes de withdrawKey
b9733ca fix(i18n): usar t() para labels de input en PipelineBuilder
a8b5451 ux: warning no-compartir key + placeholder dinámico en PipelineBuilder
3bc9934 fix: hydration mismatch PayToCallButton gaslessNote
c371ba7 ux: placeholder dinámico string schema en AgentTrialPlayground y PayToCallButton
c774bf8 ux: CopyableOutput reutilizable en sandbox, trial, pay-to-call, TryIt
d26bb57 ux(sandbox): icono Copy/Check lucide-react
9af4379 ux(sandbox): placeholder dinámico + copy resultado
80866b3 fix(i18n+publish): validar JSON raw en Step3Technical
187546f fix(i18n): usar t() para invalidJsonSchema en edit form
381409c fix(edit): mostrar errores input/output_schema en EditAgentForm
5fb7b40 fix(edit): validar JSON raw al guardar + sync form.output_schema
b23a842 fix(publish): mostrar error input/output_schema cuando servidor retorna 422
2751e36 fix(i18n): claves outputSchema en namespace publish
3d9c2f4 fix(SEC-01+02): metaValidate en PATCH+register; bloquear protocol-relative URLs
dde0987 feat(WAS-202): output schema validation antes de settlement
67e0a8e fix(WAS-206): IDOR-001 step_outputs solo al owner vía CASE WHEN
c301dba fix(SSRF-002): bloquear todos los protocolos externos en $ref
fe4a148 fix(SCOPE-001): error code scope_violation cuando fallback_slug fuera de scope
```
