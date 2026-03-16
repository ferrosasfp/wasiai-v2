# Requirements Review — Sprint 9
**Fecha:** 2026-03-15
**Reviewer:** NexusAgil Requirements Reviewer (San)
**Sprint:** 9 — input_schema obligatorio + API hardening

---

## WAS-206 — input_schema obligatorio + buildExampleFromSchema inteligente + preview en formulario

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP-AC | ALTA | No hay AC para el caso `input_schema = null/undefined` (agente sin schema al abrir el formulario de edición). El scope OUT dice "no tocar formulario de edición" pero Step3Technical.tsx es compartido entre publicación y edición. ¿El preview aparece o no cuando editas un agente existente con schema? | AC-8: WHEN creador abre formulario con input_schema preexistente, THEN preview SHALL renderizarse con el ejemplo generado del schema actual |
| 2 | GAP-AC | ALTA | AC-4 dice "WHEN campo no aparece en required[], THEN omitirlo". Pero si el schema NO tiene un array `required` definido (ausente), ¿todos los campos se incluyen o se omiten? Caso edge no cubierto. | AC-4b: WHEN input_schema no define array `required`, THEN buildExampleFromSchema SHALL incluir todos los campos definidos en `properties` |
| 3 | GAP-SCOPE | ALTA | Se mencionan dos sitios donde `buildExampleFromSchema` ya existe y está duplicada (AgentTrialPlayground.tsx y SandboxClient). El scope no dice explícitamente que se deben reemplazar los usos existentes por la función centralizada. Si no se migran, la deuda permanece. | Agregar a Scope IN: "Reemplazar llamadas a buildExampleFromSchema en AgentTrialPlayground.tsx y SandboxClient con la función centralizada" |
| 4 | GAP-AC | MEDIA | No hay AC para anidamiento/nesting. ¿Qué pasa con `properties.address.properties.street`? Las heurísticas no cubren objetos anidados — la función generará `{}` para el objeto padre pero perderá las heurísticas de los campos hijos. | AC-9: WHEN buildExampleFromSchema procesa campo de tipo object con properties, THEN SHALL recursivamente aplicar heurísticas a los campos anidados |
| 5 | GAP-AC | MEDIA | AC-5 y AC-6 indican que el valor "SHALL guardarse como metadata.input_example", pero no hay AC que especifique CUÁNDO se persiste (¿al cambiar el campo? ¿al hacer submit del form? ¿en cada keystroke del preview?). Puede causar condiciones de carrera o pérdida de datos. | AC-5b: WHEN creador avanza al siguiente paso o hace submit, THEN el estado actual del preview SHALL haberse sincronizado en el estado del formulario antes del envío |
| 6 | GAP-AC | MEDIA | Las heurísticas de descripción usan substring matching (ej: "address"). No está definido si el matching es case-insensitive. `Address`, `ADDRESS`, `walletAddress` — ¿se procesan igual? | Agregar a Constraints: "El matching de heurísticas SHALL ser case-insensitive sobre field name y description" |
| 7 | GAP-PATH | MEDIA | Edge case: schema con `type: "string"` y `enum: ["A","B","C"]`. Las heurísticas no cubren `enum` — ¿devuelve `""` o el primer valor del enum? Un ejemplo con valor fuera del enum puede confundir al usuario. | AC-10: WHEN buildExampleFromSchema procesa campo string con enum, THEN SHALL devolver `enum[0]` como valor de ejemplo |
| 8 | GAP-PATH | BAJA | Edge case: schema con `$ref`, `oneOf`, `anyOf`, `allOf`. Las heurísticas no definen comportamiento. Actualmente generaría `{}` o `[]`. Debería documentarse como comportamiento intencional o como fuera de scope. | Agregar a Scope OUT: "Schemas con $ref, oneOf, anyOf, allOf — devuelven {} sin procesamiento recursivo (v1)" |
| 9 | GAP-AC | BAJA | No hay AC de rendimiento/tamaño. Un schema con 200 propiedades generaría un preview enorme. ¿Hay límite de campos a mostrar en el preview? | Considerar: máx N campos en preview (o scroll con max-height en el componente) |
| 10 | CONFLICTO | ALTA | El scope OUT dice "no tocar formulario de edición", pero el componente Step3Technical.tsx se usa en publicación Y posiblemente en edición. Si se agrega el preview, automáticamente aparecerá en edición también. Aclarar si Step3Technical.tsx es exclusivo de publicación o compartido. | Aclarar en scope si Step3Technical.tsx es exclusivo del flujo de publicación nueva, o si también aplica al flujo edit |

**Veredicto: NECESITA CAMBIOS**
Gaps críticos: #3 (migración de usos existentes), #1 (schema preexistente en edición), #2 (required ausente), #10 (conflicto scope/componente compartido).

---

## DEUDA-01 — API no expone example_input resuelto

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP-AC | ALTA | La jerarquía de resolución es: `metadata.input_example → capabilities[0].example_input → buildExampleFromSchema(input_schema) → fallback`. Pero el código actual indica que `metadata` NO se incluye en la respuesta de `/api/v1/agents/{slug}`. Esto implica que el implementador debe también agregar la lectura de `metadata` desde Supabase. Este cambio de schema de query no está documentado en los ACs ni en los constraints. | Agregar a Constraints: "El handler deberá incluir `metadata` en el SELECT de Supabase para poder leer `metadata.input_example`" |
| 2 | GAP-AC | ALTA | AC-3 dice que si `capabilities[0].example_input` falla `JSON.parse()`, se descarta. Pero no define qué pasa si `capabilities` es un array vacío `[]` o si `capabilities[0]` es undefined. La función `resolveExampleInput` podría lanzar excepción. | AC-3b: WHEN `capabilities` está vacío o `capabilities[0]` no existe, THEN `resolveExampleInput` SHALL continuar a la siguiente jerarquía sin lanzar excepción |
| 3 | GAP-AC | MEDIA | No hay AC para el tipo del campo `example_input` en la respuesta. AC-1 dice "string JSON" pero no especifica si puede ser un objeto parseado. Los consumidores externos necesitan saber el tipo exacto: string (JSON serializado) vs objeto. | Agregar a Constraints: "example_input SHALL ser siempre un string (JSON serializado), nunca un objeto JS, para consistencia de API contract" |
| 4 | GAP-PATH | MEDIA | No hay AC para el caso en que `buildExampleFromSchema(input_schema)` retorne un objeto vacío `{}`. ¿`"{}"` es un ejemplo_input válido o se continúa al fallback `'{"input":""}'`? Actualmente AC-4 solo dice "ningún nivel produce ejemplo válido" — pero `{}` es técnicamente válido JSON. | Aclarar: WHEN `buildExampleFromSchema` retorna `{}` (schema sin propiedades), THEN ¿es válido o se usa fallback? |
| 5 | GAP-PATH | MEDIA | El endpoint `GET /api/v1/agents/discover` no está mencionado en DEUDA-01. ¿Debe también exponer `example_input`? DEUDA-02 sí lo menciona para el try/catch. La inconsistencia puede causar que discover quede desactualizado. | Aclarar si `/discover` también debe incluir `example_input` en su respuesta |
| 6 | GAP-AC | BAJA | No se especifica el comportamiento para `POST /api/v1/agents/invoke` — si el endpoint de invocación también consume `resolveExampleInput`. Fuera de scope está implícito pero no explícito. | Agregar a Scope OUT: "POST /api/v1/agents/invoke no se modifica en este ticket" |

**Veredicto: NECESITA CAMBIOS**
Gaps críticos: #1 (metadata no se lee en el handler actual — cambio de query no documentado), #2 (capabilities vacío puede lanzar excepción), lo cual bloquea la implementación correcta de `resolveExampleInput`.

---

## DEUDA-02 — APIs sin try/catch

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP-AC | ALTA | Los ACs cubren "Supabase lanza excepción" pero no diferencian entre errores de red (timeout), errores de autenticación (401 Supabase), ni errores de validación de parámetros (slug malformado). El 503 es apropiado para errores de servicio pero un slug inválido debería ser 400/404. | AC-4: WHEN el slug recibido no existe en BD (row not found), THEN SHALL devolver 404 con {"error":"not_found","message":"Agent not found"}, NO 503 |
| 2 | GAP-AC | ALTA | No hay AC para errores de timeout de Supabase. Un timeout puede lanzar un tipo de error diferente al error genérico. ¿El try/catch captura ambos? Los ACs dicen genéricamente "Supabase lanza excepción" — necesita ser explícito sobre todos los tipos que se capturan. | Agregar a Constraints: "El try/catch SHALL capturar cualquier Error incluyendo timeouts y errores de red, con el mismo formato 503" |
| 3 | GAP-SCOPE | MEDIA | Los ACs mencionan 3 endpoints pero el contexto de código actual también muestra `/api/v1/agents/discover`. Sin embargo, AC-3 sí lo menciona explícitamente. OK. Verificar que no haya otros endpoints relacionados sin cobertura (ej: `/api/v1/agents/[slug]/capabilities`). | Agregar a Scope: confirmar lista exhaustiva de endpoints afectados. ¿Hay sub-rutas de agentes no cubiertas? |
| 4 | GAP-AC | MEDIA | El constraint dice "Headers CORS en respuestas de error también" pero no hay AC que lo valide/testee. Queda como intención sin criterio de aceptación verificable. | AC-5: WHEN cualquiera de los endpoints devuelve respuesta de error (4xx/5xx), THEN SHALL incluir los mismos headers CORS que la respuesta happy path |
| 5 | GAP-PATH | MEDIA | No hay AC para respuesta cuando Supabase devuelve `{ error: ... }` sin lanzar excepción (el cliente de Supabase en JS a veces retorna errors como valores, no excepciones). El try/catch no capturaría este caso. | AC-6: WHEN Supabase retorna `{ data: null, error: <supabase_error> }`, THEN handler SHALL detectarlo y devolver 503 con formato estándar (no exponer el error de Supabase) |
| 6 | GAP-PATH | BAJA | No se especifica logging. Al suprimir el stack trace de la respuesta, ¿se loguea internamente (Sentry, console.error) para no perder visibilidad del error real? | Agregar a Constraints: "El error SHALL loguearse internamente (console.error o Sentry) antes de devolver 503, para mantener observabilidad" |

**Veredicto: NECESITA CAMBIOS**
Gaps críticos: #5 (Supabase JS retorna errors como valores, no excepciones — el try/catch no los captura), #1 (slug inexistente debe ser 404 no 503).

---

## DEUDA-03 — Activar NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true en prod

| # | Tipo | Severidad | Detalle | AC sugerido |
|---|------|-----------|---------|-------------|
| 1 | GAP-AC | ALTA | AC-3 dice "agentes existentes sin schema NO se ven afectados" pero no especifica qué significa "afectados". ¿Los creadores de agentes existentes pueden EDITAR su agente sin agregar schema? Si la variable activa la validación en el form de edición también, el creador quedaría bloqueado para editar cualquier campo aunque no toque el schema. | AC-3b: WHEN creador edita un agente existente sin input_schema y NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true, THEN formulario de edición SHALL permitir guardar sin requerir input_schema (solo publicaciones nuevas aplican la restricción) |
| 2 | GAP-AC | ALTA | No hay AC de rollback. Si se activa la variable y se detectan problemas (ej: falsos positivos bloqueando creadores legítimos), ¿cuál es el procedimiento? La activación en Vercel puede revertirse manualmente pero no está documentado como parte del criterio de Done. | Agregar a Definition of Done: "Documentar procedimiento de rollback: setear NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=false en Vercel y redeploy" |
| 3 | GAP-SCOPE | ALTA | El constraint dice "Agregar en Vercel: wasiai-prod + wasiai-v2, environments: production + preview". Pero si se agrega en `preview`, también afectará a PRs en preview deployments — potencialmente bloqueando developers que hacen pruebas sin schema. ¿Es intencional? | Aclarar: ¿La variable debe activarse en `preview` environments o solo `production`? Considerar activar solo en `production` inicialmente. |
| 4 | GAP-AC | MEDIA | AC-1 y AC-2 dicen "formulario SHALL mostrar error y bloquear submit" pero no especifican el mensaje de error exacto. Para una HU de UX, la copia del mensaje es un detalle relevante que puede generar retrabajo si el QA lo rechaza. | Agregar: WHEN el submit es bloqueado, THEN el mensaje SHALL ser "Input schema is required to publish your agent" (o el string equivalente acordado) |
| 5 | GAP-PATH | MEDIA | No hay AC para el environment de `development` local. ¿Los developers necesitan activar la variable localmente para que su build refleje el comportamiento de prod? Sin esto, pueden mergear código que funciona local pero falla en prod. | Agregar a Constraints: "Documentar en .env.example que NEXT_PUBLIC_REQUIRE_INPUT_SCHEMA=true debe activarse localmente para probar el flujo completo" |
| 6 | GAP-DEPENDENCIA | ALTA | Este ticket depende de WAS-206 (que tiene veredicto NECESITA CAMBIOS). Si WAS-206 no está completo y estable, activar la variable expondrá el formulario con comportamiento incompleto. La dependencia es correcta pero debe ser estricta: DEUDA-03 no puede iniciarse hasta que WAS-206 esté en DONE. | Confirmar en Jira/Linear que el dependency lock está activo: DEUDA-03 blocked hasta WAS-206 = DONE |

**Veredicto: NECESITA CAMBIOS**
Gaps críticos: #1 (agentes existentes en edición quedan bloqueados), #3 (activación en preview environments puede romper PRs de dev), #6 (dependencia de WAS-206 que tiene gaps propios).

---

## Veredicto Global

**NECESITA CAMBIOS** — Los 4 Work Items requieren revisión antes de aprobar para desarrollo.

### Lista de cambios requeridos por prioridad:

**🔴 Críticos (bloquean implementación correcta):**
1. **WAS-206 #10** — Aclarar si Step3Technical.tsx es compartido con edición (conflicto scope OUT vs realidad del componente)
2. **WAS-206 #3** — Definir explícitamente migración de usos duplicados en AgentTrialPlayground.tsx y SandboxClient
3. **WAS-206 #2** — Definir comportamiento cuando `required[]` está ausente en el schema
4. **DEUDA-01 #1** — Documentar que el handler debe agregar `metadata` al SELECT de Supabase (cambio de query no trivial)
5. **DEUDA-01 #2** — Cubrir el caso `capabilities[]` vacío en `resolveExampleInput`
6. **DEUDA-02 #5** — Cubrir el patrón `{ data: null, error }` de Supabase JS (no lanza excepción, el try/catch no lo captura)
7. **DEUDA-02 #1** — Diferenciar 404 (slug no encontrado) de 503 (error de servicio)
8. **DEUDA-03 #1** — Proteger el flujo de edición de agentes existentes (AC-3 ambiguo)
9. **DEUDA-03 #3** — Decisión explícita sobre environments: ¿preview incluido o solo production?

**🟡 Medios (causan retrabajo en QA si no se resuelven):**
10. **WAS-206 #1** — AC para schema preexistente al editar agente
11. **WAS-206 #5b** — Momento exacto de persistencia del preview en metadata
12. **WAS-206 #6** — Especificar case-insensitive en heurísticas
13. **WAS-206 #7** — Comportamiento con campos `enum`
14. **DEUDA-01 #4** — Definir si `{}` es resultado válido o se usa fallback
15. **DEUDA-02 #4** — Convertir constraint CORS en AC verificable
16. **DEUDA-02 #6** — Agregar logging interno antes de suprimir stack trace
17. **DEUDA-03 #4** — Definir copia exacta del mensaje de error de validación
18. **DEUDA-03 #5** — Documentar activación local en .env.example

**🟢 Bajos (mejoras menores, no bloquean):**
19. **WAS-206 #8** — Documentar $ref/oneOf/anyOf como fuera de scope v1
20. **WAS-206 #9** — Considerar límite de campos en preview
21. **DEUDA-01 #5** — Aclarar si `/discover` también expone `example_input`
22. **DEUDA-03 #2** — Documentar procedimiento de rollback

---

*Generado por NexusAgil Requirements Reviewer — Sprint 9 | 2026-03-15*
