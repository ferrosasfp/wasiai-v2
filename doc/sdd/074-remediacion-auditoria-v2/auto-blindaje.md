# Auto-Blindaje — WAS-V2-INT (facilitator auth integration)

### [2026-05-29 19:30] W2 — `toHaveBeenCalledWith` rompió por arg posicional nuevo
- **Error**: 3 tests existentes del router fallaron (`AC-3` x2, `AC-6`) tras agregar un 4º arg `apiKey` a `verifyExternal`/`settleExternal`. Producción ahora llama siempre con 4 args; las aserciones `toHaveBeenNthCalledWith(n, env, url, signal)` esperaban exactamente 3.
- **Causa raíz**: Vitest `toHaveBeenCalledWith`/`toHaveBeenNthCalledWith` comparan el array de argumentos completo por longitud + valor. `[a,b,c]` ≠ `[a,b,c,undefined]`. Al threadear un nuevo parámetro posicional opcional, TODA aserción de call-args existente sobre esos spies queda desactualizada aunque el valor sea `undefined`.
- **Fix**: actualizar cada aserción positiva para incluir el 4º arg explícito: `undefined` en ramas UVD/wasiai-sin-key, `'sk-...'` en wasiai-con-key. Las aserciones negativas (`.not.toHaveBeenCalledWith(... 3 args)` para "UVD nunca llamado") siguen válidas y se dejaron en 3 args.
- **Aplicar en**: cualquier HU que agregue un parámetro a una función mockeada con spies que ya tengan aserciones `toHaveBeenCalledWith`. Hacer `grep "toHaveBeenCalledWith\|toHaveBeenNthCalledWith"` ANTES de implementar y contar args. También sumar el nuevo arg al objeto de mock del módulo (`getWasiaiFacilitatorApiKey: vi.fn(() => null)`), o el spy queda `undefined` y los imports rompen.

### [2026-05-29 19:30] W2 — sentinel `null` vs `undefined` en el threading del key
- **Error potencial (evitado)**: `getWasiaiFacilitatorApiKey()` retorna `string | null` (patrón tri-state), pero `tryExternal`/`postJson` esperan `apiKey?: string` (`string | undefined`). Pasar `null` directo activaría el header con `Bearer null` o fallaría el guard `if (apiKey)`.
- **Causa raíz**: dos convenciones de "ausente" en juego — config usa `null`, el client usa `undefined`.
- **Fix**: en CASE C convertir explícito: `const wasiaiApiKey = getWasiaiFacilitatorApiKey() ?? undefined`. El guard del client es `if (apiKey)` que ya descarta `''`/`undefined`, pero la conversión mantiene el tipo limpio (`string | undefined`).
- **Aplicar en**: cualquier punto donde un getter tri-state (`null`) alimente una API que use `undefined` como "ausente". Convertir en el borde con `?? undefined`.
