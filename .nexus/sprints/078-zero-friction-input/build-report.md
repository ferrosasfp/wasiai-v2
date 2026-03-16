## Build Report — WAS-205

### Wave execution

| Wave | Status | Build | Detalle |
|------|--------|-------|---------|
| Wave 0 — Pre-flight | ✅ PASS | — | DEUDA-01 DONE confirmado. EXAMPLE_PAYLOADS hardcodeado detectado en SandboxClient.tsx (líneas 12, 234) y TryIt.tsx (líneas 13, 22, 30). |
| Wave 1 — SandboxClient.tsx | ✅ DONE | ✅ PASS | Eliminado import `buildExampleFromSchema`/`EXAMPLE_FALLBACK`. Agregado estado `inputDirty`, callback `fetchExampleInput`, función `handleSlugChange`. Select onChange migrado. Textarea: placeholder literal + marcar dirty en onChange. useEffect pre-carga ejemplo del primer agente. |
| Wave 2 — TryIt.tsx | ✅ DONE | ✅ PASS | Eliminados `EXAMPLE_PAYLOADS` y `getExamplePayload`. Agregado estado `payloadDirty`, función async `fetchAndSetPayload`. `handleSlugChange` modificado: reset dirty + void fetch. Textarea marcado dirty en onChange. useEffect inicial migrado a `fetchAndSetPayload`. |
| Wave 3 — Build final + commit | ✅ DONE | ✅ PASS | `npx tsc --noEmit` sin errores. `grep EXAMPLE_PAYLOADS src/` = 0 resultados. Commit local creado. |

### Commit

- **Hash:** `6278a8567`
- **Message:** `feat(WAS-205): replace hardcoded EXAMPLE_PAYLOADS with dynamic API fetch in Sandbox and TryIt`
- **Files changed:** 2 (`SandboxClient.tsx`, `TryIt.tsx`)
- **Stats:** 52 insertions, 23 deletions
