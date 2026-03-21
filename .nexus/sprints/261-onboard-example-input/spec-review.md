## Spec Review — SDD #261

**Reviewer:** Spec Reviewer (subagent)  
**Fecha:** 2026-03-20  
**SDD:** `sdd.md` rev 1

---

### Wave 0 Results

| Paso | Resultado | Detalle |
|------|-----------|---------|
| 0.1 Fix ya existe? | ⚠️ PARCIAL | `inferExampleInput` no existe, pero `buildExampleFromSchema` ya existe en `src/features/agents/utils/buildExampleFromSchema.ts` — mucho más robusto (maneja nested objects, enums, arrays, descriptions). SDD lo ignora y propone duplicar una versión simplificada. |
| 0.2 Archivos existen? | ✅ | `step/route.ts`, `start/route.ts`, `register/route.ts` — todos presentes |
| 0.3a Tipos correctos? | ✅ | DB: `input_schema` JSONB nullable, `example_input` existe. Insert actual NO incluye ninguno de los dos — correcto. |
| 0.3b Dependencias no mencionadas? | ⚠️ | `resolveExampleInput.ts` usa `buildExampleFromSchema` para display. Si el wizard guarda schemas en formato flat (`{field: "string"}`) pero `buildExampleFromSchema` espera JSON Schema (`{type:"object", properties:{...}}`), el display NO podrá inferir ejemplos de agentes registrados via wizard. |
| 0.4 Wave sequence ejecutable? | 🔴 BLOQUEANTE | Ambigüedad de step numbering impide ejecución sin errores (ver Finding #1) |

---

### Findings

| # | Severidad | Detalle | Archivo:línea |
|---|-----------|---------|---------------|
| 1 | 🔴 BLOQUEANTE | **Contradicción en numeración de steps.** El SDD dice agregar `QUESTIONS[8]` y `case 8` para input_schema. Pero la nota "IMPORTANTE" dice el flujo es `7(input_schema)→8(email+insert)`. Si input_schema es case 8, el email+insert (case 7 actual) se ejecutaría ANTES de recoger el schema — el agente se insertaría sin `input_schema`. El Builder no puede saber si debe renumerar case 7→8 y meter input_schema como case 7, o dejar case 7 y agregar case 8 después. | sdd.md §4.1 |
| 2 | 🔴 BLOQUEANTE | **Breaking change no documentado.** Cambiar `input_schema` de `z.unknown().optional().nullable()` a `z.record(z.unknown())` rompe la API pública. Cualquier caller existente que no envíe `input_schema` recibirá 400. El SDD no menciona: (a) versionado de API, (b) período de deprecation, (c) comunicación a integradores. Mínimo debe ser `.optional()` con un warning header, o documentar que es breaking change aceptado. | register/route.ts:75 |
| 3 | 🟡 ALTO | **Formato de schema inconsistente.** El wizard pide schema como `{"wallet":"string","network":"string"}` (flat key→typeHint). Pero `buildExampleFromSchema` (usado en display por `resolveExampleInput`) espera JSON Schema estándar (`{type:"object", properties:{wallet:{type:"string"}}}`) . Agentes registrados via wizard tendrán `input_schema` en formato flat que `buildExampleFromSchema` no puede procesar → display mostrará fallback `{"input":""}`. | buildExampleFromSchema.ts + sdd.md §4 |
| 4 | 🟡 ALTO | **Duplicación innecesaria de lógica.** Ya existe `buildExampleFromSchema` en `src/features/agents/utils/` — robusto, testeado, maneja nested objects, enums, arrays, optional fields. SDD propone crear `inferExampleInput` simplificada y duplicarla en 2 archivos. Esto crea 3 funciones de inferencia distintas con comportamiento divergente. Debería reutilizar `buildExampleFromSchema` o al menos mencionarlo como alternativa evaluada. | src/features/agents/utils/buildExampleFromSchema.ts |
| 5 | 🟡 MEDIO | **`z.record(z.unknown())` acepta demasiado.** Valida que sea un objeto, pero acepta `{"a": [1,2,3], "b": {"nested": true}}` — valores que `inferExampleInput` no maneja (solo procesa strings como typeHint via `String(typeHint).toLowerCase()`). Si alguien envía un JSON Schema real via register API, `inferExampleInput` lo procesaría incorrectamente (ej: `String({type:"string"})` → `"[object Object]"` → placeholder string). | sdd.md §4 inferExampleInput |
| 6 | 🟡 MEDIO | **SDD dice "el insert NUNCA debe quedar con `example_input: '{"input":""}'`"** pero la función `inferExampleInput` no tiene ese guard. Si el schema parsed tiene campos pero todos los tipos son unrecognized objects, cada campo genera `"<field>"` — que sí es distinto del fallback, pero podría ser igualmente inútil. Falta constraint de calidad mínima. | sdd.md §7 |
| 7 | 🟢 BAJO | **Wizard no valida `metaValidateSchema` para input_schema.** Register API llama `metaValidateSchema()` para sanitizar schemas, pero el case 8 del wizard solo valida JSON parseable + non-empty. Un usuario podría inyectar campos maliciosos via wizard que register API rechazaría. | sdd.md §4.1 case 8 vs register/route.ts:166 |

---

### Veredicto

**🔴 BLOQUEANTE** — No proceder a Builder hasta resolver:

1. **Resolver contradicción de step numbering** (Finding #1): Definir explícitamente qué case number tiene input_schema y qué case number tiene email+insert. Actualizar tanto QUESTIONS como switch cases con números concretos.

2. **Decidir sobre breaking change en register API** (Finding #2): O hacerlo `.optional()` con deprecation warning, o documentar explícitamente que es breaking change aceptado con justificación.

3. **Alinear formato de schema** (Finding #3): Decidir si `input_schema` es flat map (`{field: "type"}`) o JSON Schema estándar (`{type:"object", properties:{...}}`). Unificar con `buildExampleFromSchema` existente o documentar por qué se diverge.
