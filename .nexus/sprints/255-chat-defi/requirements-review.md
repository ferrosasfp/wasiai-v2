# Requirements Review — WAS-255: Chat DeFi

**Reviewer:** Requirements Reviewer (subagent)  
**Date:** 2026-03-20  
**Verdict:** 🔴 NECESITA CAMBIOS

---

## 1. AC Quality

| AC | Problema | Severidad |
|----|----------|-----------|
| AC1 | No especifica el formato de output del LLM (¿JSON con array de slugs? ¿JSON con steps de compose?). Sin contrato de parsing, dos implementaciones divergirán. | 🔴 BLOCKER |
| AC1 | No define qué pasa si el LLM mapea la pregunta a 0 agentes o a >5 agentes (MAX_STEPS = 5 en compose). Falta AC de error. | 🔴 BLOCKER |
| AC2 | **Conflicto arquitectónico:** AC2 dice "mostrar cada step con loading/done/error" durante la ejecución, pero Scope OUT excluye streaming y `/api/v1/chat` sería bloqueante hasta que compose termine. Si el endpoint no es streaming ni devuelve job_id para polling, la UI solo puede mostrar estados finales, no intermedios. Esto hace AC2 imposible de cumplir tal como está. | 🔴 BLOCKER |
| AC3 | "Links a receipts en Snowtrace" — `compose` devuelve `receipt_signature` (EIP-712 off-chain) y `call_id` (UUID interno), **no** `tx_hash` on-chain. No existe un enlace a Snowtrace para estos receipts. El AC es arquitectónicamente incorrecto o requiere una redefinición de qué es un "receipt link". | 🔴 BLOCKER |
| AC4 | Dice "agent key" pero el sistema usa `x-api-key`. Naming ambiguo menor, pero puede confundir al implementador. | 🟡 MENOR |
| AC4 | No especifica dónde el cliente lee/guarda la key (localStorage, cookie, input en UI). Sin esto el componente de chat no sabe cómo obtenerla. | 🟠 IMPORTANTE |
| AC6 | "Funcionar correctamente en mobile" sin breakpoints ni comportamiento específico es no-testable. ¿Qué viewport? ¿Qué elementos collapsan? | 🟡 MENOR |
| AC7 | No lista las strings que necesitan traducción. El implementador tiene que adivinar el scope. | 🟡 MENOR |

---

## 2. Path Coverage

| Ruta | Estado |
|------|--------|
| Happy path: pregunta → pipeline → resultado legible | Cubierta (AC1, AC3) pero con blockers arriba |
| Error path: step falla a mitad del pipeline | Cubierta (AC5) |
| Error path: key inválida / ausente | Cubierta (AC4) |
| **Edge: pregunta ambigua que no mapea a ningún agente** | ❌ NO CUBIERTA |
| **Edge: pregunta que mapea a >5 agentes (MAX_STEPS)** | ❌ NO CUBIERTA |
| **Edge: saldo insuficiente para el pipeline generado** | ❌ NO CUBIERTA |
| **Edge: todos los providers LLM fallan (callLLM exhausted)** | ❌ NO CUBIERTA |
| **Edge: timeout de /api/v1/chat** (5 steps × 8s = hasta 40s, Next.js default = 10s) | ❌ NO CUBIERTA — riesgo real |
| **Edge: pregunta en español cuando el LLM espera inglés (o viceversa)** | ❌ NO CUBIERTA |
| Error path: red caída (fetch a /api/v1/chat falla) | ❌ NO CUBIERTA en ACs (solo en code pattern) |

---

## 3. Scope

| Ítem | Problema |
|------|----------|
| "Link en navegación" está en Scope IN pero sin AC que lo especifique (texto, ícono, posición, i18n key). | 🟠 IMPORTANTE |
| No se especifica si `/api/v1/chat` requiere auth de sesión Supabase además de la agent key, o solo la agent key. `/api/v1/compose` solo usa `x-api-key`. | 🟠 IMPORTANTE |
| El prompt del LLM para mapear pregunta → agentes no está especificado. Es el núcleo del feature y no hay ninguna referencia a él. ¿Prompt en inglés? ¿Devuelve JSON con `steps[]`? ¿Cuál es el schema? | 🔴 BLOCKER |
| No define el schema de request/response de `/api/v1/chat`. Sin contrato, frontend y backend no pueden desarrollarse en paralelo. | 🔴 BLOCKER |

---

## 4. Current Code — Conflictos y Solapamientos

| Hallazgo | Tipo |
|----------|------|
| `callLLM` (Groq→Cerebras→Together) ya existe y funciona. No necesita implementación. Referenciarlo explícitamente en el WI evita re-implementación. | ✅ OK (ya existe) |
| `compose` usa header `x-api-key` (confirmado en `route.ts` línea ~160 y en `PipelinePageClient.tsx`). AC4 dice "agent key" — debe alinearse. | 🟡 Naming fix |
| `transformStepOutput` ya existe en `route.ts`. El chat endpoint puede llamar `/api/v1/compose` internamente o reutilizar la lógica — la estrategia no está definida. | 🟠 Decisión pendiente |
| `MAX_STEPS = 5` en compose. Si el LLM genera más de 5 steps, compose rechazará con 400. No hay AC de límite en chat. | 🔴 Conflict |
| `AbortSignal.timeout(10_000)` en `callLLM` — cada llamada LLM tiene 10s de timeout. Si el classify + compose total excede el timeout de Next.js (default 10s), la ruta fallará silenciosamente. Necesita `export const maxDuration = 60` en la ruta. | 🔴 BLOCKER técnico |

---

## 5. Dependencies

| Dependencia | Estado |
|-------------|--------|
| WAS-254 (Transform Layer) | ✅ DONE — compose ya encadena con auto-transform |
| Variables de entorno LLM (`GROQ_API_KEY`, `CEREBRAS_API_KEY`, `TOGETHER_API_KEY`) | No mencionadas en WI. Deben estar en `.env` para que funcione el interpret step. |
| **DB migration:** ¿`pipeline_executions` / `agent_calls` necesitan nuevo `source = 'chat'` para distinguir pipelines creados desde chat vs pipelines directos? | ❌ No evaluado en WI |
| **i18n:** `/messages/en.json` y `/messages/es.json` necesitan nueva sección `chat`. No hay keys definidas. | ❌ Falta spec |
| **Deploy:** `export const maxDuration` en la ruta del chat para evitar timeout en Vercel (si aplica). | ❌ No mencionado |

---

## Resumen de Blockers

1. **AC2 vs no-streaming:** Definir si `/api/v1/chat` es (a) streaming SSE con step events, (b) polling vía job_id, o (c) single-response (y AC2 se reescribe para estados finales).
2. **Prompt del LLM:** Definir el system prompt y el schema JSON de output para el classify step.
3. **Schema de /api/v1/chat:** Definir request `{ question: string, api_key?: string }` y response.
4. **AC3 Snowtrace:** Los receipts son off-chain. Redefinir qué enlace se muestra (¿call_id en dashboard interno? ¿hash de la firma?).
5. **MAX_STEPS=5 límite:** Agregar AC de cómo manejar preguntas que requieren >5 agentes.
6. **Next.js maxDuration:** Agregar requerimiento técnico de `export const maxDuration = 60` (o equivalent) en la ruta.

---

## Verdict

**🔴 NECESITA CAMBIOS**

Hay 4 blockers arquitectónicos (AC2/streaming, prompt spec, API contract, AC3/Snowtrace) y 2 edge cases críticos sin cubrir (>MAX_STEPS, timeout). El WI puede implementarse parcialmente pero producirá un feature incompleto o con UX rota si se proceede sin resolver los blockers primero.
