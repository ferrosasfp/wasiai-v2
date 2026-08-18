# Auto-Blindaje — #077 [WKH-361]

Un bloque por error REAL cometido durante F3. Si no hubo errores, este archivo
no existe.

---

### [2026-08-18 14:16] Wave 2 — `vi.mock` referenció un `const` del archivo y explotó al colectar

- **Error**: `src/app/api/v1/status/delegation/__tests__/route.test.ts` definía
  `const A2A_URL` / `const FORWARD_KEY` arriba y los usaba dentro de la factory
  de `vi.mock('@/lib/env', …)`. El archivo entero falló al colectar con
  `ReferenceError: Cannot access 'A2A_URL' before initialization`, reportando
  `Tests: no tests`.
- **Causa raíz**: `vi.mock` se **hoistea por encima de todas las declaraciones**
  del archivo. Cuando corre la factory, los `const` del módulo todavía están en
  su zona muerta temporal. El exemplar que el Story File cita (§6.4,
  `forward-handler.test.ts:8-15`) no lo mostraba porque ahí los valores están
  **inline** dentro de la factory, no en variables.
- **Fix**: mover los valores a `vi.hoisted(() => ({ … }))` y que la factory lea
  de ahí; los alias `const A2A_URL = secrets.A2A_URL` quedan para los `expect`.
  Es el mismo patrón que ya usa
  `src/app/api/cron/__tests__/process-refunds.test.ts:7-9` para los spies.
- **Aplicar en**: cualquier test nuevo de esta HU que quiera parametrizar el
  mock de `@/lib/env` — el del cron de W2 y cualquier futuro. Si un archivo de
  test reporta `Tests: no tests` en vez de un fallo de aserción, sospechar del
  colectado, no del caso.
- **Cómo lo detecté**: corriendo el archivo solo *antes* de seguir escribiendo.
  Un `npm test` completo lo habría mostrado igual, pero mezclado con 86 archivos
  verdes.
