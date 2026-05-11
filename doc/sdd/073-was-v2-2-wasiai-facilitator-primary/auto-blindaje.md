# Auto-Blindaje — WAS-V2-2 (wasiai-facilitator primary)

Errores cometidos durante F3 + F4 (fix-pack) y cómo prevenirlos en futuras HUs.

---

## AB-WAS-V2-2-1: CD strictness vs CI policy conflict — verificar `npm run lint` ANTES de declarar done

- **Fecha**: 2026-05-11
- **Wave**: W2 (refactor de `usdcSettler.ts` a delegador de `facilitator-router`)
- **Error**: Tras delegar la lógica de routing/telemetría al router, dejé en `usdcSettler.ts` dos helpers (`normalizeInternalErrorCode` y `extractCode`) que quedaron sin caller dentro del archivo. Los dejé por **interpretación estricta de CD-14** ("preservar líneas 1-338 intactas"), pero CI (`eslint --max-warnings 0`) los marcó como `@typescript-eslint/no-unused-vars` y el pipeline rompió.
- **Causa raíz**: Confundí "no cambiar comportamiento" (espíritu de CD-14) con "no tocar ninguna línea" (interpretación pedante). Story §6 W2.1 línea 648 dice literal: *"Removing unused imports is NOT a violation of CD-14"* — extensible a dead helpers privados que ya no tienen caller. Adicionalmente, **no corrí `npm run lint` localmente** antes de cerrar la wave; me apoyé sólo en `tsc --noEmit` y tests, que NO detectan unused-vars con la severidad de CI.
- **Fix**: Eliminar los helpers y su JSDoc huérfano (`usdcSettler.ts` líneas 33-92). El router ya tiene su propio `extractCode` privado, por lo que no se pierde funcionalidad. Resultado: `npm run lint` exit 0, 445 tests siguen pasando.
- **Aplicar en**:
  - **Toda HU** que refactoree código: correr `npm run lint` localmente como parte del Done Definition de F3, junto a `tsc --noEmit` y `npm test`. Lint con `--max-warnings 0` falla en warnings que TS no ve.
  - **Constraint Directives "preserve lines X-Y"**: leer la justificación textual del CD antes de inflexibilizar. Si el CD protege "behavior", borrar dead code DESPUÉS del refactor está permitido. Cuando un CD parezca ambiguo entre "no tocar nada" vs "no cambiar comportamiento", **escalar al Architect** antes de la entrega, no después del AR.
  - **Checklist pre-commit del Dev**: `tsc --noEmit && npm run lint && npm test --silent --run` — los tres son obligatorios, no opcionales. Un lint warning hoy es un CI red mañana.

---

## AB-WAS-V2-2-2: Mocking at fetch boundary hides AbortSignal lifecycle bugs

- **Fecha**: 2026-05-11
- **Wave**: W1 (router) — bug nacido en W1, detectado por Adversary post-F3
- **Error**: En `facilitator-router.ts` CASE C-fail (línea ~282 original), pasaba el mismo `AbortSignal` al fallback de UVD que ya había usado wasiai. Cuando wasiai timeoutea de verdad, ese signal queda `aborted=true` y la siguiente `fetch(uvdUrl, { signal })` aborta inmediatamente → fallback nunca corre → caída total del payment path en prod. Los 21 tests originales del router **NO detectaron este bug** porque los mocks de `verifyExternal/settleExternal` resuelven sincrónicamente con `mockResolvedValueOnce` — el signal nunca llega a abortarse en tests.
- **Causa raíz**: La microoptimización "reutilizar signal para evitar crear otro" introdujo un acoplamiento de ciclo de vida entre dos llamadas independientes. El AbortController es **stateful y unidireccional** (una vez aborted, lo está para siempre). Para fallback paths, cada attempt necesita su propia timeout boundary. El test gap viene de que mockear **al boundary del cliente HTTP** (verifyExternal/settleExternal) saltea el ciclo de vida real del signal — un test sano debe simular la dinámica del signal cuando se testea código que lo consume.
- **Fix**:
  1. `facilitator-router.ts:319` — `runUvdOrInternal` siempre crea un signal nuevo con `AbortSignal.timeout(30_000)`, nunca reusa el de wasiai.
  2. Eliminado el campo `wasiaiSignal` de `RunUvdArgs`.
  3. `trySettle` CASE C-fail no propaga signal en `args`.
  4. Test nuevo en `facilitator-router.test.ts` usa `vi.useFakeTimers()` + `mockImplementationOnce` que `await`ea el evento `abort` del signal (emula fetch real bajo timeout). Asserts: UVD recibe signal diferente, UVD signal NO está aborted al ser llamado, wasiai signal SÍ está aborted post `advanceTimersByTimeAsync(30_001)`.
- **Aplicar en**:
  - **Cualquier nuevo código que mezcle `AbortSignal` + fallback/retry**: una llamada = un signal. Nunca compartir signals entre attempts independientes. Si el código intenta optimizar reusándolos, es bug latente.
  - **Tests de networking code**: cuando el path bajo prueba consume `AbortSignal`, agregar **al menos un test** con `vi.useFakeTimers()` + mock que aguarde el evento `abort` antes de resolver/rechazar. Mocks puramente síncronos (`mockResolvedValueOnce`) sólo prueban el happy path; el ciclo de vida del signal queda ciego.
  - **Adversarial review obligatorio**: AR debe buscar "shared/passed/reused AbortSignal" en cualquier PR que toque fallback paths o retry loops y marcarlo BLOQUEANTE si encuentra reuso entre attempts.
  - **Patrón canónico para fallback con timeout**:
    ```ts
    // OK
    const primarySignal = AbortSignal.timeout(30_000)
    const primaryResult = await tryPrimary(primarySignal)
    if (!primaryResult.ok) {
      const fallbackSignal = AbortSignal.timeout(30_000) // <- fresh
      return await tryFallback(fallbackSignal)
    }

    // MAL — shared signal collapses fallback under primary timeout
    const signal = AbortSignal.timeout(30_000)
    const primaryResult = await tryPrimary(signal)
    if (!primaryResult.ok) {
      return await tryFallback(signal) // <- aborted!
    }
    ```
