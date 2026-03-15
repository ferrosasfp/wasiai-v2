## Build Report — SDD #074

### Wave execution
| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 | ✅ PASS | — | `append_step_output` confirmado en bloque serial (~L662). Bloque `allSettled` ubicado ~L694. Fix NO estaba implementado. |
| Wave 1 | ✅ PASS | ✅ Clean | Añadida captura de `groupStartIndex = globalStepIndex` antes del `allSettled`. Añadida llamada best-effort `append_step_output` tras cada fulfilled exitoso. |
| Wave 2 | ✅ PASS | ✅ Clean | `npx tsc --noEmit` sin errores ni warnings. |

### Commit
- Hash: `865094ad6`
- Message: `fix(compose): persist step outputs for parallel groups (WAS-204)`
- Files changed: 1 (`src/app/api/v1/compose/route.ts`, +8 líneas)

### Discrepancias encontradas
Ninguna. El código estaba estructurado exactamente como describía el SDD. La variable `stepIdx = globalStepIndex + i` ya existía y equivale a `groupStartIndex + i`; se usó `groupStartIndex + i` explícitamente para mayor claridad y correctitud (capturado antes del bucle).

### Notas
- El fix es idéntico en patrón al bloque serial existente (~L662-L666).
- Se usa `gr.value.output` (ya resuelto del fulfilled) en lugar de `result.output`.
- Se accede a `group[i].agent_slug` para obtener el slug del step paralelo.
- No se tocó ningún step serial, lógica de retry, cobros ni Supabase RPC.
