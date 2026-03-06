# SDD-040 — WAS-137: Edit Agent campos faltantes

**Fecha:** 2026-03-04  
**Modo:** QUALITY  
**Archivo:** `src/app/[locale]/creator/agents/[slug]/edit/EditAgentForm.tsx`

## Objetivo
Agregar 6 campos del schema que existen en el Create Wizard pero faltan en EditAgentForm:
`cover_image`, `capabilities`, `free_trial_enabled`, `free_trial_limit`, `max_rpm`, `max_rpd`.

## Waves

### Wave 1 — Tipos + estado inicial
- Extender `AgentRow` con los 6 campos nuevos
- Extender `useState(form)` inicial con los 6 campos
- Agregar imports: `useRef`, `Image`, `useFileUpload`, `CapabilitiesEditor`, `CapabilitiesEditorRef`

### Wave 2 — UI: cover_image
- Reutilizar patrón de Step1Basic: drop zone + fileInputRef + useFileUpload
- Mostrar imagen actual si existe (next/image)
- Botón ✕ para limpiar

### Wave 3 — UI: capabilities
- Reutilizar `CapabilitiesEditor` con ref para validate()
- Llamar validate() en handleSubmit antes de enviar

### Wave 4 — UI: free_trial toggle + rate limits
- Toggle boolean `free_trial_enabled` + input numérico `free_trial_limit` (visible solo si enabled)
- Section colapsable `<details>` para max_rpm / max_rpd (patrón Step2Product)

### Wave 5 — Incluir campos en PATCH body
- `handleSubmit`: incluir los 6 campos nuevos en `JSON.stringify(result.data)`
- Verificar que updateSchema los acepta (ya los tiene via createModelSchema.partial())

## Constraint Directives
- CD-1: Import `useFileUpload` desde `@/hooks/useFileUpload`
- CD-2: Import `CapabilitiesEditor`, `CapabilitiesEditorRef` desde `@/features/publish/CapabilitiesEditor`
- CD-3: `capabilitiesEditorRef = useRef<CapabilitiesEditorRef>(null)`
- CD-4: cover_image nullable — `agent.cover_image ?? null`
- CD-5: No tocar el API route — ya acepta todos los campos
- CD-6: updateSchema ya incluye los campos vía createModelSchema.omit({slug}).partial()

## ACs
- AC-1: cover_image editable con upload y preview
- AC-2: capabilities editable con CapabilitiesEditor
- AC-3: free_trial_enabled toggle + free_trial_limit input
- AC-4: max_rpm / max_rpd en sección colapsable
- AC-5: Todos pre-populados al cargar
- AC-6: PATCH persiste todos correctamente
