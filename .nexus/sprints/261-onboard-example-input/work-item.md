# WAS-258 → Sprint #261 — Wizard onboarding: example_input e input_schema obligatorios

**Tipo:** improvement  
**Clasificación:** HU-MINOR  
**Fecha:** 2026-03-20  
**Linear:** WAS-258

## Problema

El wizard de onboarding tiene 7 pasos. No solicita `example_input` ni `input_schema`. El agente queda registrado con:
- `example_input: {"input": ""}` genérico  
- `input_schema: null`

Un caller que descubre el agente no sabe qué enviar — el agente es no-invocable.

## Archivos relevantes

- `src/app/api/v1/onboard/step/route.ts` — QUESTIONS dict + switch handler + agent insert
- `src/app/api/v1/onboard/start/route.ts` — total_steps: 7

## Solución propuesta

Agregar 2 pasos nuevos al wizard (pasos 8 y 9):

**Paso 8 — example_input (obligatorio):**
- Pregunta: "Give an example of a valid input for your agent (JSON format)"
- Hint: "e.g. {\"query\": \"What is the price of AVAX?\"}"
- Validación: debe ser JSON parseable, no puede ser `{"input": ""}` genérico
- NO puede estar vacío

**Paso 9 — input_schema (opcional):**
- Pregunta: "Describe your agent's input schema (optional). Type \"skip\" to continue."
- Hint: "e.g. {\"query\": \"string — your question\"}"
- Puede skiparse

El agent insert (actualmente en step 7, pasaría a step 9) debe incluir:
- `example_input: JSON.stringify(data.example_input)`
- `input_schema: data.input_schema ?? null`

`total_steps` en start/route.ts debe actualizarse de 7 a 9.

## Acceptance Criteria

- AC1: WHEN step 8 is reached, SHALL ask for example_input in JSON format
- AC2: IF example_input is empty or equals `{"input":""}` SHALL reject with 400
- AC3: IF example_input is not valid JSON SHALL reject with 400
- AC4: WHEN step 9 is reached, SHALL ask for input_schema (skippable with "skip")
- AC5: WHEN agent is inserted, SHALL include example_input and input_schema fields
- AC6: start/route.ts total_steps SHALL be updated to 9
- AC7: TypeScript build SHALL pass
