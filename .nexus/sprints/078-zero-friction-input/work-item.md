# WAS-205 — Zero-Friction Input: Pre-loaded Examples en Todas las Superficies

**Tipo:** HU-MAJOR  
**Fecha:** 2026-03-15  
**Prioridad:** Alta  

---

## Contexto

Cuando un usuario (humano o agente IA) interactúa con un agente del marketplace de WasiAI, debe adivinar el formato del input. El placeholder muestra campos como `<token>` que no son claros. Esto genera fricción en **todas** las superficies de interacción.

El `metadata.input_example` ya existe en la BD por agente. El problema es que no se usa consistentemente.

**Superficies afectadas:**
1. **Free Trial** (`AgentTrialPlayground.tsx`) — textarea vacía (parcialmente corregido)
2. **Sandbox** (`SandboxClient.tsx`) — `EXAMPLE_PAYLOADS` hardcodeado, no lee BD
3. **TryIt (Docs)** (`TryIt.tsx`) — `EXAMPLE_PAYLOADS` hardcodeado, no dinámico
4. **API** (`GET /api/v1/agents/{slug}`) — no expone `example_input` resuelto
5. **API Docs** — ejemplos curl hardcodeados, no reflejan input real del agente

---

## User Story

**Como** desarrollador o agente IA que descubre un agente en WasiAI,  
**Quiero** ver un ejemplo de input pre-cargado y funcional en cada superficie de interacción,  
**Para** poder ejecutar el agente con cero fricción sin leer documentación adicional.

---

## Scope

**IN:**
- `AgentTrialPlayground.tsx` — pre-cargar textarea con ejemplo resuelto
- `SandboxClient.tsx` — reemplazar `EXAMPLE_PAYLOADS` con llamada a API
- `TryIt.tsx` — reemplazar `EXAMPLE_PAYLOADS` con llamada a API
- `GET /api/v1/agents/{slug}` — exponer campo `example_input` resuelto
- `buildExampleFromSchema` — asegurar output sin `<placeholder>`

**OUT:**
- No resetear textarea si el usuario ya lo modificó manualmente
- No migrar ejemplos en BD (solo lectura, no escritura)
- No afectar historial de ejecuciones guardadas en Sandbox
- `CodeExamples.tsx` — ya funciona correctamente, no tocar
- SDK / superficie móvil — fuera de este sprint

---

## Acceptance Criteria (EARS)

**AC-1:** WHEN el usuario abre la página de detalle de cualquier agente, THEN el textarea del Free Trial SHALL estar pre-cargado con el ejemplo resuelto (siguiendo jerarquía de fuentes), listo para enviar sin modificación.

**AC-2:** WHEN el usuario selecciona un agente en el Sandbox (al cambiar el select), THEN el textarea de input SHALL actualizarse inmediatamente con el ejemplo del agente obtenido de `GET /api/v1/agents/{slug}` campo `example_input`, sin bloquear la UI.

**AC-3:** WHEN el usuario selecciona un agente en el TryIt de Docs (al cambiar el select), THEN el payload SHALL pre-cargarse con el ejemplo real del agente desde la API, reemplazando `EXAMPLE_PAYLOADS` estático.

**AC-4:** WHEN un agente no tiene `metadata.input_example` ni `capabilities[0].example_input`, THEN el sistema SHALL generar un ejemplo desde `input_schema` usando `buildExampleFromSchema`, y si `input_schema` también es null, SHALL usar el fallback `{"input": "your text here"}`, garantizando que el textarea nunca quede vacío ni muestre `<placeholder>`.

**AC-5:** WHEN `GET /api/v1/agents/{slug}` responde, THEN SHALL incluir el campo `example_input` (string JSON) resuelto según la jerarquía de fuentes, para que agentes IA puedan autoconfigurar sus llamadas sin fricción.

**AC-6:** WHEN se renderiza la documentación de un agente (API Docs / curl examples), THEN los ejemplos SHALL usar el `example_input` resuelto del agente, no strings hardcodeados genéricos.

**AC-7:** WHEN la llamada a `GET /api/v1/agents/{slug}` falla (timeout, 4xx, 5xx) en Sandbox o TryIt, THEN el sistema SHALL mostrar el fallback `{"input": "your text here"}` sin bloquear la UI, y SHALL registrar el error en consola sin mostrar error al usuario.

**AC-8:** WHEN `buildExampleFromSchema(schema)` es llamado, THEN SHALL retornar un JSON string válido sin caracteres `<` o `>`, produciendo valores de tipo correcto (string vacío para `string`, `0` para `number`, `[]` para `array`), o `null` si el schema no puede procesarse.

**AC-9:** WHEN `metadata.input_example` o `capabilities[0].example_input` existe en BD pero falla `JSON.parse()`, THEN el sistema SHALL descartarlo silenciosamente y continuar al siguiente nivel de la jerarquía de fuentes, nunca mostrando JSON inválido en UI.

---

## Jerarquía de fuentes (orden de prioridad)

1. `metadata.input_example` — string JSON en BD (validar con JSON.parse)
2. `capabilities[0].example_input` — string JSON en BD (validar con JSON.parse)
3. `buildExampleFromSchema(input_schema)` — generado, sin `<placeholder>`, con valores reales
4. `'{"input": "your text here"}'` — fallback final garantizado

---

## Constraints

- **PROHIBIDO** hardcodear ejemplos por slug — siempre leer de BD o generar desde schema
- **OBLIGATORIO** que el ejemplo pre-cargado sea JSON válido y ejecutable
- **PROHIBIDO** mostrar `<placeholder>` o `<fieldname>` en producción
- **PROHIBIDO** resetear el textarea si el usuario ya lo modificó
- No romper el API contract existente — campos nuevos son aditivos
