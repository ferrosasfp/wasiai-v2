# Spec Review — SDD #262

**Reviewer:** Spec Reviewer (subagent)
**Fecha:** 2026-03-20
**SDD:** `262-onboard-multi-agent/sdd.md`

---

## Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe? | ✅ NO | `owner_id` solo aparece en step/route.ts:182 como `userData.user.id` (flujo actual). No hay `x-agent-key` en ningún archivo. El fix NO existe aún. |
| 0.2 Archivos existen? | ✅ SÍ | `start/route.ts` y `step/route.ts` existen en `src/app/api/v1/onboard/` |
| 0.3a `data` es JSONB? | ✅ SÍ | `session.data` se usa como `Record<string, unknown>` y acepta campos arbitrarios. Almacenar `owner_id` es compatible. |
| 0.3b `createHash` disponible? | ⚠️ NECESITA IMPORT | `createHash` NO está importado en `start/route.ts`. El SDD lo menciona en "Imports a agregar" pero no muestra el import statement explícito. `import { createHash } from 'crypto'` es necesario. |
| 0.3c `createServiceClient` disponible? | ✅ SÍ | Ya importado en start/route.ts línea 2. |
| 0.4 Wave sequence ejecutable? | ✅ SÍ | Wave 1 modifica start/route.ts (independiente), Wave 2 modifica step/route.ts. No hay dependencia circular. Build gate en cada wave. |

---

## Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| F1 | 🟡 MEDIA | **`total_steps` actual es 7, no 8.** El SDD asume que el flujo actual tiene 8 steps (con email como step 8) y que agent-key reduce a 7. Pero `start/route.ts:32` ya retorna `total_steps: 7`. El step 7 actual ES el email step. Esto significa que el SDD tiene una inconsistencia: si #261 aún no se ha aplicado, el flujo actual es de 7 steps (no 8). El SDD dice "Si se implementa en branches separados, aplicar #261 primero" — esto es una **dependencia dura**, no una nota. El Builder DEBE aplicar #261 primero o el `total_steps` será incorrecto. | start/route.ts:32 |
| F2 | 🟡 MEDIA | **Switch en step/route.ts usa cases fijos 1-7.** El case 7 (línea ~151) es el email step hoy. El SDD propone que con agent-key, step 7 sea input_schema+insert. Pero el switch actual no tiene case 8. El Builder necesita: (1) aplicar #261 primero (agrega case 7=input_schema, case 8=email), y luego (2) aplicar #262 (en case 7, si isAgentKeyFlow, hacer insert). Sin #261, no hay dónde poner el bifurcación. | step/route.ts:case 7 |
| F3 | 🟢 BAJA | **`agent_keys.name` NO tiene UNIQUE constraint.** La tabla tiene `name TEXT NOT NULL` sin unique index. El SDD propone usar `name: slug` para evitar colisión con `'wizard-agent'`, lo cual funciona por buena práctica pero no hay constraint que lo enforce. Si dos agentes tienen el mismo slug (edge case), habrá duplicados en `name`. No bloqueante pero el Builder debería considerar un unique index `(owner_id, name)`. | migrations/00000000000003:55 |
| F4 | 🟢 BAJA | **Rollback en agent-key flow es seguro.** El código propuesto solo hace `delete().eq('key_hash', hash)` — no toca el user. ✅ Correcto según AC7. | SDD §4.2 |
| F5 | 🟢 BAJA | **`example_input` en agent-key insert pero no en flujo actual.** El SDD agrega `example_input: data.example_input ? JSON.stringify(...) : '{}'` al insert del agent-key flow, pero el flujo actual (step 7 en step/route.ts) no tiene ese campo. Probablemente viene de #261. Otra señal de dependencia con #261. | SDD §4.2 |
| F6 | 🟢 BAJA | **Wizard UI no se menciona en total_steps.** El `total_steps` se retorna en la API response de `/start`. Si hay un frontend wizard que muestra progress (e.g., "Step 3 of 7"), el cambio dinámico de total_steps será transparente para el frontend siempre que use el valor retornado. El SDD lo marca como Scope OUT (UI del wizard), lo cual es correcto. | — |
| F7 | 🟡 MEDIA | **`input_schema` no tiene step de recolección en agent-key flow.** El SDD dice steps 1-7 son: name, desc, endpoint, category, price, tags, input_schema. Pero el step 7 actual (sin #261) es email, y steps 1-6 ya cubren name→tags. ¿Dónde se recolecta `input_schema` sin #261? Esto confirma que #261 es un **prerequisito obligatorio**. | SDD §4.1 |

---

## Veredicto

### ⚠️ BLOQUEANTE — 1 dependencia dura

**El SDD #262 NO puede implementarse sin SDD #261 aplicado primero.**

El flujo actual tiene 7 steps (1-6 = datos del agente, 7 = email). El SDD #262 asume un flujo de 8 steps (1-7 = datos + input_schema, 8 = email) que solo existirá después de #261.

**Acción requerida:** Cambiar la nota de coordinación (§8) de "nota" a **prerequisito obligatorio** en el SDD, o fusionar ambos SDDs en uno solo.

**Si se acepta la dependencia con #261 como prerequisito explícito:** el resto del SDD es técnicamente correcto y el veredicto cambia a **LISTO**.

### Items menores para el Builder:
1. Agregar `import { createHash } from 'crypto'` explícito en start/route.ts
2. Considerar unique index `(owner_id, name)` en agent_keys (no bloqueante)
