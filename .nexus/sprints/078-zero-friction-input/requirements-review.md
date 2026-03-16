# Requirements Review — WAS-205
**Reviewer:** NexusAgil Requirements Bot  
**Fecha:** 2026-03-15  
**Sprint:** 078-zero-friction-input

---

### Findings

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| F-01 | Gap de path | 🔴 ALTA | No hay AC para cuando la API falla al cargar el ejemplo en Sandbox/TryIt. Si GET /api/v1/agents/{slug} responde 4xx/5xx, ¿qué se muestra? Fallback al dict hardcodeado, vacío, o error visible? | AC-7 |
| F-02 | Gap de path | 🔴 ALTA | AC-4 define generación de ejemplo desde input_schema, pero no especifica qué pasa cuando `input_schema` también es null/vacío. El fallback final `{"input": "your text here"}` está en la sección "Fuente de verdad" pero no en ningún AC verificable. | AC-4 (ampliar) |
| F-03 | Calidad de AC | 🟡 MEDIA | AC-5 y AC-6 son casi idénticos — ambos hablan de GET /api/v1/agents devolviendo `example_input` resuelto. AC-5 habla del list endpoint, AC-6 del detail endpoint. No está claro si el list también debe resolverlo (costoso). Riesgo de implementar solo uno. | Fusionar o diferenciar explícitamente |
| F-04 | Scope OUT ausente | 🟡 MEDIA | No hay Scope OUT explícito. Riesgos obvios no excluidos: ¿Se actualiza el ejemplo si el usuario ya modificó el textarea? ¿Se resetea al re-seleccionar el mismo agente? ¿Afecta el historial de ejecuciones guardadas en Sandbox? | Agregar sección Scope |
| F-05 | Gap de path | 🟡 MEDIA | No hay AC para la superficie "API Docs" (curl examples) mencionada en Contexto como superficie afectada #5. Está en el contexto pero no tiene AC propio. | AC-8 |
| F-06 | AC ya implementado | 🟢 BAJA | AC-1 para AgentTrialPlayground.tsx está **parcialmente implementado** según el código actual (`defaultInput = inputExample ?? buildExampleFromSchema(...)`). El AC debería marcarse como "Verificar/Test only" o dividirse: implementación de prop vs. asegurar que el servidor pase `inputExample` correctamente. | Anotar estado parcial |
| F-07 | Calidad de AC | 🟡 MEDIA | AC-2 dice "obtenido de /api/v1/agents/{slug}" pero no especifica **cuándo** se hace la llamada: ¿al montar el componente, al cambiar el select, o al cargar la página? Ambigüedad de timing puede causar race conditions. | AC-2 (precisar trigger) |
| F-08 | Dependencia oculta | 🟡 MEDIA | `buildExampleFromSchema` se menciona como fallback en AC-4 pero no hay AC ni constraint que defina el comportamiento esperado de esta función (¿qué produce para tipo `string`? ¿para `array`? ¿para schema circular?). Es una dependencia de implementación sin spec. | AC-9 |
| F-09 | Gap de path | 🔴 ALTA | No hay AC para validación: ¿qué pasa si `metadata.input_example` existe en BD pero es JSON inválido? El constraint dice "OBLIGATORIO JSON válido" pero no hay AC que especifique qué hace el sistema cuando la fuente #1 o #2 falla la validación JSON. | AC-10 |
| F-10 | Scope IN difuso | 🟡 MEDIA | "CodeExamples — ya recibe inputExample" aparece como superficie afectada pero sin ningún AC. Si ya funciona, debería estar en Scope OUT. Si necesita verificación, necesita AC. Estado ambiguo. | Clarificar en Scope |

---

### ACs sugeridos (agregar)

**AC-7 (Error path — API down):**  
WHEN la llamada a GET /api/v1/agents/{slug} falla (timeout, 4xx, 5xx) en Sandbox o TryIt, THEN el sistema SHALL mostrar el fallback `{"input": "your text here"}` sin bloquear la UI, y SHALL registrar el error en consola.

**AC-4 ampliado (input_schema null):**  
Agregar condición: WHEN `input_schema` también es null o vacío, THEN SHALL usar el fallback final `'{"input": "your text here"}'`, garantizando que el textarea nunca quede vacío.

**AC-8 (API Docs / curl examples):**  
WHEN se renderiza la documentación de un agente en API Docs, THEN los ejemplos curl SHALL usar el `example_input` resuelto del agente (siguiendo la misma jerarquía de fuentes), no strings hardcodeados.

**AC-9 (Contract de buildExampleFromSchema):**  
WHEN `buildExampleFromSchema(schema)` es llamado, THEN SHALL retornar un JSON string válido sin caracteres `<` o `>`, produciendo valores de tipo correcto (string vacío para `string`, `0` para `number`, `[]` para `array`), o `null` si el schema no puede procesarse.

**AC-10 (Validación de ejemplo en BD):**  
WHEN `metadata.input_example` o `capabilities[0].example_input` existe pero falla `JSON.parse()`, THEN el sistema SHALL descartarlo silenciosamente y continuar al siguiente nivel de la jerarquía de fuentes, nunca mostrando JSON inválido en UI.

---

### Scope sugerido (agregar al WI)

**IN:**
- AgentTrialPlayground.tsx — pre-cargar textarea con ejemplo resuelto
- SandboxClient.tsx — reemplazar EXAMPLE_PAYLOADS con llamada a API
- TryIt.tsx — reemplazar EXAMPLE_PAYLOADS con llamada a API
- API GET /api/v1/agents/{slug} — exponer campo `example_input` resuelto
- buildExampleFromSchema — asegurar output sin `<placeholder>`

**OUT:**
- No resetear textarea si el usuario ya lo modificó manualmente
- No migrar ejemplos en BD (solo lectura, no escritura)
- No afectar historial de ejecuciones guardadas
- CodeExamples — ya funciona, no tocar
- Superficie móvil / SDK — fuera de este sprint

---

### Veredicto

**NECESITA CAMBIOS**

3 findings de severidad ALTA (F-01, F-02, F-09) deben resolverse antes de pasar a desarrollo:
1. Error path cuando API falla (F-01) — sin esto, Sandbox/TryIt pueden quedar en estado roto
2. Fallback cuando input_schema es null (F-02) — el constraint existe pero no hay AC verificable
3. JSON inválido en BD (F-09) — escenario real de producción sin manejo definido

Los findings MEDIA pueden resolverse en refinamiento o como sub-tasks del sprint.
