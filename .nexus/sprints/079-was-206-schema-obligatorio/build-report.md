# Build Report — WAS-206

## Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 — Pre-flight | ✅ PASS | — | `utils/` dir no existía. `buildExampleFromSchema` encontrada como local en 3 archivos (AgentTrialPlayground, SandboxClient, PayToCallButton). `input_example` ausente en schema y PATCH body. |
| Wave 1 — Crear util centralizado | ✅ PASS | ✅ 0 errores | Creado `src/features/agents/utils/buildExampleFromSchema.ts` con heurísticas, función pura, sin `<` ni `>` en outputs. |
| Wave 2 — Preview en Step3Technical | ✅ PASS | ✅ 0 errores | Agregado `input_example` a model.schema.ts. Añadidos `inputExampleRaw`, `exampleEditedByUser`, `debounceRef` a Step3Technical. Preview textarea con debounce 300ms. `input_example` incluido en PATCH de PublishForm.tsx. |
| Wave 3 — Migrar duplicados | ✅ PASS | ✅ 0 errores | AgentTrialPlayground y SandboxClient migrados a import del util. Funciones locales eliminadas. Uso de `EXAMPLE_FALLBACK` en lugar de strings hardcoded. |
| Wave 4 — Build final + commit | ✅ PASS | ✅ 0 errores | Commit local realizado. NO git push (per instrucciones). |

## Commit

- Hash: `f755ef4d9`
- Message: `feat(WAS-206): centralize buildExampleFromSchema with smart heuristics + preview in publish form`
- Files changed: 21 (incluye archivos del sprint .nexus + código fuente)

## Archivos modificados (código fuente)

| Archivo | Acción |
|---------|--------|
| `src/features/agents/utils/buildExampleFromSchema.ts` | CREADO |
| `src/lib/schemas/model.schema.ts` | Agregado campo `input_example` |
| `src/components/publish/Step3Technical.tsx` | Preview editable + auto-generación |
| `src/app/[locale]/publish/PublishForm.tsx` | `input_example` en PATCH body |
| `src/features/agents/components/AgentTrialPlayground.tsx` | Migrado a util centralizado |
| `src/app/[locale]/sandbox/SandboxClient.tsx` | Migrado a util centralizado |

## Discrepancias encontradas

1. **PayToCallButton.tsx no incluido en SDD** — también tiene función local `buildExampleFromSchema` pero el SDD no la menciona. No fue modificada (principio "nada más, nada menos").
2. **`utils/` dir no existía** — creado automáticamente con `mkdir -p`. No es discrepancia bloqueante.
3. **SandboxClient placeholder null** — la nueva función devuelve `string | null` pero `placeholder` acepta `string | undefined`. Se usó `?? EXAMPLE_FALLBACK` para compatibilidad de tipos (espíritu del SDD: sin `<` ni `>`).
