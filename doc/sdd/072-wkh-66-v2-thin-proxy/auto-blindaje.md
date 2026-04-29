# Auto-Blindaje — WKH-66 — v2 thin-proxy refactor

### [2026-04-28 21:25] Wave 3 — RequestInit DOM vs Next type mismatch
- **Error**: `TS2345 Argument of type 'RequestInit & { duplex: "half" }' is not assignable to NextRequest constructor parameter — signal: AbortSignal | null vs AbortSignal | undefined`.
- **Causa raíz**: Next 16 expone su propio `RequestInit` cuyo `signal` excluye `null`. El lib.dom global usa `AbortSignal | null`. Cuando se construye un `NextRequest` con un init basado en `req.headers` y casteado al `RequestInit` del DOM, el constructor rechaza el cast.
- **Fix**: Usar `ConstructorParameters<typeof NextRequest>[1]` como tipo de destino del cast vía `unknown`, asegurando alineación con la firma exacta del constructor de Next. Mantener la propiedad `duplex: 'half'` (requerida por undici cuando `body` es presente).
- **Aplicar en**: cualquier futuro proxy/route que reconstruya un `NextRequest` con body — usar el mismo patrón `as unknown as ConstructorParameters<typeof NextRequest>[1]`.

### [2026-04-28 21:28] Wave 3 — Tests trial.test.ts baseline failures
- **Error**: 6 tests en `src/app/api/v1/agents/__tests__/trial.test.ts` fallan con assertion `expected 400 to be 200/502/504`.
- **Causa raíz**: pre-existente en `main` antes de WKH-66. Baseline confirmado vía `git stash` + run de la suite contra el código original.
- **Fix**: NO aplica a WKH-66 (Scope OUT — `src/app/api/v1/agents/`). Documentar como baseline y dejar para una HU separada de mantenimiento del trial endpoint.
- **Aplicar en**: cualquier HU que toque `/api/v1/agents/[slug]/trial` debería arreglar estos tests primero.
