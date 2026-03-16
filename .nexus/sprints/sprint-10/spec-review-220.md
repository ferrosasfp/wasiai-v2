# Spec Review — SDD #WAS-220

> Revisor: Spec Reviewer (NexusAgil v1.3)
> Fecha: 2026-03-16
> SDD: Audit y corrección de paths de insert en agent_calls

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix existe | ✅ PASS | El fix NO existe aún — `payment_type` ausente en 3 de 4 paths; `agent_slug` ausente en 2 de 4 paths |
| 0.2 Archivos existen | ❌ FAIL | **`src/lib/x402/x402Handler.ts` NO EXISTE**. La lógica x402 está inlineada en `invoke/route.ts`. Los otros 3 archivos sí existen. |
| 0.3a Tipos correctos | ❌ FAIL | El SDD propone `payment_type: 'api_key'` y `'free_trial'` pero el CHECK constraint actual solo permite `('x402', 'sandbox')`. Insertar `'api_key'` rompe la DB. |
| 0.3b DB columns | ⚠️ PARCIAL | `agent_slug` ya existe en schema (migración 012). `payment_type` existe pero con CHECK incompleto (ver 0.3a). |
| 0.3c Seguridad contratos | N/A | No aplica (no hay contratos en este SDD) |
| 0.3d DB Security | N/A | No hay funciones SQL nuevas en este SDD |
| 0.4 Dependencias | ⚠️ RIESGO | WAS-219 agrega NOT NULL constraint. Si WAS-220 no se completa ANTES que WAS-219 se aplique en prod, la app se rompe. El SDD no documenta el orden explícito de deployment. |
| 0.5 Completitud | ❌ FAIL | Ver findings #1, #2, #3, #4 |

---

## Coherencia

| Check | Resultado | Detalle |
|-------|-----------|---------|
| AC → Wave trazabilidad | ⚠️ PARCIAL | AC-5 (free_trial) y AC-6 (x402Handler slug param) no tienen wave que los resuelva correctamente dado que x402Handler.ts no existe |
| Build gates | ✅ PASS | Wave 1 tiene BUILD GATE |
| Rollback | ✅ PASS | Rollback presente y ejecutable |
| Constraints | ✅ PASS | 3 PROHIBIDO presentes y específicos |

---

## Findings

| # | Severidad | Detalle | Corrección sugerida |
|---|-----------|---------|---------------------|
| 1 | **BLOQUEANTE** | `src/lib/x402/x402Handler.ts` NO EXISTE. La lógica x402 está inlineada en `invoke/route.ts` (funciones `settleX402`, `extractPaymentFromHeaders`, `build402Instructions`). No hay un handler externo que modificar. | Reemplazar W1.4 con: "En `invoke/route.ts`, agregar `payment_type` al insert dentro de `logCall()`. El slug ya está disponible." |
| 2 | **BLOQUEANTE** | El CHECK constraint en `agent_calls.payment_type` (migración 032) solo permite `('x402', 'sandbox')`. El SDD propone insertar `'api_key'` (invoke Route A) y `'free_trial'` (AC-5), que violarán el constraint en runtime con error 23514. | El SDD debe incluir una wave de migración SQL que expanda el CHECK: `ALTER TABLE agent_calls DROP CONSTRAINT agent_calls_payment_type_check; ALTER TABLE agent_calls ADD CONSTRAINT agent_calls_payment_type_check CHECK (payment_type IN ('x402', 'sandbox', 'api_key', 'free_trial'));` O coordinar con WAS-219 para que incluya esto. |
| 3 | **BLOQUEANTE** | `logCall()` en `invoke/route.ts` no recibe `payment_type` como parámetro. El SDD dice "agregar payment_type según contexto" pero la función es compartida por Route A (api_key) y Route B (x402). La firma actual no permite discriminar. | Agregar parámetro `paymentType: string` a `logCall()` y pasarlo desde Route A (`'api_key'`) y Route B (`'x402'`). El SDD debe especificar esto explícitamente. |
| 4 | **BLOQUEANTE** | `sandbox/invoke/[slug]/route.ts`: `agent_slug` falta en AMBOS inserts (schema_violation y normal) aunque el SDD lo identifica como uno de los 4 paths a corregir. El SDD solo menciona agregar `payment_type`, pero `agent_slug` también falta. | En W1.2, especificar agregar también `agent_slug: slug` a los dos inserts del sandbox handler. |
| 5 | **BLOQUEANTE** | `compose/route.ts`: Los inserts en `executeStep()` no tienen ni `payment_type` ni `agent_slug`. El `agent_slug` está disponible como `agent.slug` dentro del scope. El SDD menciona "verificar slug" pero no especifica el valor a usar. | Aclarar en el SDD que el valor es `agent_slug: agent.slug` y `payment_type: 'api_key'` (compose solo acepta api_key auth). |
| 6 | MENOR | Hay 3 paths ADICIONALES con inserts a `agent_calls` que el SDD no menciona: `trial/route.ts`, `mcp/route.ts`, `introspect/route.ts`. Si WAS-219 agrega NOT NULL sin DEFAULT, estos paths también romperán. | Expandir el scope del audit (Wave 0) o crear tickets separados para estos paths. |
| 7 | MENOR | AC-7 (0 nulls en dev en 30 min) puede ser difícil de verificar si los paths adicionales (#6) no están cubiertos. Una llamada vía MCP o trial en esos 30 min generaría nulls que no son responsabilidad de WAS-220. | Aclarar que la query de verificación debe filtrar por los paths corregidos, o expandir el scope. |
| 8 | MENOR | AC-5 dice "free_trial" pero ninguna wave implementa este tipo. No existe un path de `free_trial` en el código auditado. | Confirmar si AC-5 es un caso real o eliminar del SDD. Si existe en `trial/route.ts`, agregar a scope. |
| 9 | INFO | El SDD referencia `invoke/route.ts` como "exemplar" para los otros paths, lo cual es correcto conceptualmente, pero actualmente ese mismo archivo tampoco tiene `payment_type` en su insert. No puede ser exemplar de algo que no implementa todavía. | Actualizar la tabla de ejemplares o aclarar que es el modelo del patrón a implementar, no del estado actual. |

---

## Veredicto

**NECESITA CORRECCIÓN** — 5 findings bloqueantes.

### Lista de bloqueantes a resolver antes de SPEC_APPROVED:

1. **Eliminar referencia a `x402Handler.ts`** (no existe) — reemplazar W1.4 con instrucción concreta en `invoke/route.ts`
2. **Agregar migración SQL** que expanda el CHECK constraint de `payment_type` para incluir `'api_key'` y `'free_trial'`
3. **Especificar firma de `logCall()`** — agregar parámetro `paymentType` con valores concretos por call site
4. **Sandbox handler**: especificar que también falta `agent_slug` (no solo `payment_type`)
5. **Compose handler**: especificar valores concretos para ambos campos en los dos inserts de `executeStep()`
