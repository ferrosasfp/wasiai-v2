# WasiAI — Metodología de Ingeniería
## Nexus Factory × BMAD Method v6
> Fuente: WasiAI_Metodologia.pptx — San × Fer 2026
> Este archivo es la referencia permanente. Todo agente lo lee antes de operar.

---

## ¿Por qué existe esta metodología?

- Código en producción con bugs de seguridad (API keys expuestas, path traversal)
- Roles mezclados: Dev tomando decisiones de arquitectura sin spec
- Features implementadas sin que Fer haya leído lo que se construyó
- 51 tests verdes, 3 vulnerabilidades en prod
- Retrabajo por specs ambiguas

**La metodología no es burocracia — es la diferencia entre código que pasa tests y código que sobrevive producción.**

---

## Los dos frameworks

### BMAD Method v6
- Agentes especializados por fase (PM · Architect · Dev · QA separados)
- Gates de aprobación explícitos
- Story files autocontenidos
- Adversarial Review obligatorio
- Cadencia semanal (Planning / Status / Retro)

### Nexus Factory (Golden Path — reglas inmutables)
- Stack Web2: Next.js 14 · Supabase · Tailwind · next-intl · Upstash Redis
- Stack Web3: Avalanche C-Chain · Solidity 0.8.24 · Foundry · viem v2 · wagmi v3
- Pagos: x402 + ERC-3009 · NUNCA ethers.js
- **Sin** `NEXT_PUBLIC_` para secrets
- **Sin** hardcodes de addresses
- **Sin** datos simulados en producción

---

## El flujo completo

```
IDEA
  ↓
[FASE 1 — DISCOVERY]
  S0: PM genera HU + ACs + Scope + Riesgos
  ⛔ GATE 1: HU_APPROVED
  (Fer escribe "HU_APPROVED" después de leer el artefacto S0)
  ↓
[FASE 2 — SPEC]
  S1: SDD (rutas, schema, on-chain, UI, DoD)
  Implementation Readiness Check
  ⛔ GATE 2: SPEC_APPROVED
  (Fer escribe "SPEC_APPROVED" después de leer el SDD)
  ↓
[FASE 2.5 — STORY FILE]
  SM genera story-HU-X.X.md autocontenido
  ⚠️ Sin story file → NO se codea. Sin excepciones.
  ↓
[FASE 3 — IMPLEMENTACIÓN]
  Orden: Migration DB → Contrato + forge tests → Backend → Frontend → Tests unitarios
  Adversarial Review ANTES de cada commit
  ↓
[FASE 4 — VALIDACIÓN]
  QA verifica cada AC del story file
  forge test → todos pasan
  npm run build → 0 errores TS
  DoD completo ✅
  git push origin master master:main
```

---

## Los Gates — lo más importante

### ⛔ GATE 1: HU_APPROVED
**Activa el gate:** Fer escribe `HU_APPROVED` explícitamente después de leer el S0.
**NO activa el gate:** "Go" · "Dale" · "Sí" · "Suena bien" · "Avanza" · "ok"

### ⛔ GATE 2: SPEC_APPROVED
**Activa el gate:** Fer escribe `SPEC_APPROVED` explícitamente después de leer el SDD.
**NO activa el gate:** "Implementa" · "Empieza" · "Avanza" · cualquier otra cosa

---

## Fase 1 — Discovery (BMAD: PM + Analyst + Architect)

- **Analyst:** Idea vaga → Brainstorm / Brief / Market Research (cuando la idea necesita validación)
- **PM (S0):** Genera HU + Acceptance Criteria + Scope + Riesgos — **siempre, por cada feature**
- **Architect:** Decisión técnica compleja → ADR documentado (nuevo contrato / nueva tabla crítica / cambio de patrón)

---

## Fase 2 — Spec (BMAD: SDD)

El SDD debe contener:
- ✓ Rutas y endpoints exactos (método, path, headers, body, respuesta)
- ✓ Schema de DB (tablas nuevas, columnas, RLS policies)
- ✓ Cambios on-chain (contrato, eventos, funciones)
- ✓ Componentes UI (estructura, props, estado)
- ✓ Definition of Done (checklist verificable)

Luego: **Implementation Readiness Check** — ¿Es implementable sin ambigüedades? ¿Dependencias listas? ¿ACs verificables?

---

## Fase 2.5 — Story File (BMAD: SM)

El story file (`story-HU-X.X.md`) contiene:
- Historia de usuario completa
- Acceptance Criteria verificables (uno a uno)
- Estructura de archivos exacta
- API pública / tipos / interfaces
- Endpoints que consume y produce
- Definition of Done con checkboxes
- Notas de implementación (patrones del codebase)

**El Dev implementa SOLO desde el story file — sin necesitar contexto adicional.**

---

## Fase 3 — Implementación (Nexus + BMAD: Dev)

Orden obligatorio:
1. Migration de DB (si hay cambio de schema)
2. Contrato + forge tests (si hay cambio on-chain — 59/59)
3. Backend (routes, services, lógica)
4. Frontend (components, hooks, pages)
5. Tests unitarios (Vitest junto al código)

**Adversarial Review ANTES de cada commit.**

---

## Adversarial Review — El más importante

**Cómo activarlo correctamente (BMAD nativo):**
```
Actúa como Adversarial Reviewer.
Lee _bmad/core/tasks/review-adversarial-general.xml
y revisa el diff/código de: [archivos o git diff]
```

BMAD lo ejecuta en modo cínico — asume que hay problemas, busca al menos 10 issues.

Su trabajo es **ENCONTRAR problemas**, no confirmar que todo está bien.

- 🔐 **Auth bypass:** rutas sin auth, escalada de privilegios
- 🌐 **SSRF:** endpoints con URLs del usuario
- ⚡ **Race conditions:** operaciones financieras sin atomicidad
- 🔑 **API keys expuestas:** en logs, errores, objetos públicos
- 📍 **Hardcodes:** addresses, amounts, URLs en lugar de env vars
- 🧪 **Datos simulados:** mocks o datos falsos en rutas de producción

Formato: **BLOQUEANTE** · **MENOR** · **OK**

---

## Code Review — Después del AR

**Cómo activarlo correctamente (BMAD nativo):**
```
Actúa como Code Reviewer.
Lee _bmad/bmm/workflows/4-implementation/code-review/instructions.xml
y revisa el story file: story-HU-X.X.md
```

BMAD CR hace mucho más que revisar calidad — valida el story file completo:
- Corre `git diff` para verificar qué cambió REALMENTE vs lo que el Dev reporta
- Verifica cada AC del story file contra el código implementado
- Detecta tareas marcadas `[x]` que no están realmente implementadas
- Sincroniza `sprint-status.yaml` automáticamente al terminar

Severidades: **HIGH** (debe corregirse) · **MEDIUM** (debe corregirse) · **LOW** (nice to fix)

---

## Fase 4 — Validación (BMAD: QA)

- Verifica cada AC del story file contra la implementación real
- No asume — lee el código
- ✅ CUMPLE / ❌ NO CUMPLE / ⚠️ PARCIAL
- forge test → todos pasan
- npm run build → 0 errores TS
- Sin ethers.js imports
- RLS verificado en tablas nuevas
- DoD del story: todos ✅
- `git push origin master master:main`

**El QA se hace DESDE los ACs del story — no desde lo que se implementó.**

---

## Cadencia Semanal (BMAD: SM)

| Día | Ceremonia | Output |
|---|---|---|
| Lunes | Sprint Planning | sprint-status.yaml con 3 historias |
| Miércoles | Sprint Status | Progreso, bloqueos, ajustes |
| Viernes | Retrospectiva | Qué funcionó, qué cambiamos |

---

## Cómo activar cada agente BMAD

| Agente | Comando |
|---|---|
| PM | `Actúa como PM. Lee _bmad/bmm/agents/pm.md` |
| Architect | `Actúa como Architect. Lee _bmad/bmm/agents/architect.md` |
| SM | `Actúa como SM. Lee _bmad/bmm/agents/sm.md` |
| Dev | `Actúa como Dev. Lee _bmad/bmm/agents/dev.md` |
| **AR** | `Actúa como AR. Lee _bmad/core/tasks/review-adversarial-general.xml` |
| **CR** | `Actúa como CR. Lee _bmad/bmm/workflows/4-implementation/code-review/instructions.xml` |
| QA | `Actúa como QA. Lee _bmad/bmm/agents/qa.md` |

AR y CR referencian sus archivos BMAD nativos — no prompts inventados.

---

## Errores frecuentes — aprendidos en producción

1. **Implementar sin story file** — el SDD no reemplaza al story
2. **"Go" como gate** — los gates requieren el texto exacto
3. **Activar AR/CR con prompts inventados** — usar siempre los archivos BMAD nativos
4. **Tests verdes ≠ producción segura** — los tests prueban el happy path, el AR prueba los ataques
5. **Roles mezclados** — el Dev no toma decisiones de arquitectura

---

## Referencia visual completa
Archivo original: `.nexus/docs/WasiAI_Metodologia.pptx`

---

*Última actualización: 2026-02-27 — San*
