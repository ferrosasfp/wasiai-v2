# WAS-257 — Web3Provider: Lazy-load como chunk asíncrono separado

**Tipo:** HU-MAJOR | **Clasificación:** Pipeline QUALITY (sin Security Gate) | **Fecha:** 2026-03-20  
**Archivos:** `src/app/[locale]/layout.tsx`, `src/shared/providers/Web3Provider.tsx`

---

## Contexto

`Web3Provider` (wagmi + viem + @tanstack/react-query, ~400KB) está importado estáticamente en el root layout, lo que hace que forme parte del **bundle principal** que bloquea el initial render.

### Alcance real del fix (importante)

`next/dynamic + ssr: false` en el root layout hace que Web3Provider sea un **chunk asíncrono separado** que:
- ✅ No bloquea el SSR ni el initial HTML
- ✅ No es parte del bundle principal (mejora TTI y parse time)
- ⚠️ El browser SÍ descarga el chunk en todas las páginas una vez que hidrata (es async, no condicional por ruta)

El beneficio real: Web3Provider deja de bloquear el initial render. El bundle se divide en chunks. Para eliminarlo completamente de páginas non-Web3 se requeriría mover el provider fuera del root layout (scope mucho mayor, fuera de este ticket).

---

## Acceptance Criteria (EARS)

- **AC1:** WHEN the app builds, THE Web3Provider code SHALL be emitted as a separate async chunk (not included in the main layout bundle), verifiable via `next build` output chunks.
- **AC2:** WHEN a user visits any page, THE initial HTML SHALL NOT contain Web3Provider SSR output (ssr: false).
- **AC3:** WHEN dynamic import is pending, the layout SHALL render a non-null fallback that does not cause blank screen or block rendering of non-Web3 content (e.g., `null` or `<>{children}</>`).
- **AC4:** WHEN Web3Provider resolves, `useAccount()` and wagmi hooks SHALL return valid context in `/publish`, `/creator/dashboard`, and `/agent-keys`.
- **AC5:** WHEN page hydrates, SHALL NOT produce React hydration mismatch warnings in browser console.
- **AC6:** WHEN user navigates client-side from a non-Web3 route to `/publish`, `/creator/dashboard`, or `/agent-keys`, Web3Provider SHALL be loaded and functional before the user can trigger a wallet interaction.
- **AC7:** WHEN the change is applied, THE TypeScript build SHALL pass with zero errors.
- **AC8:** WHEN applied, THE existing `Web3ErrorBoundary` SHALL remain wrapping the dynamic Web3Provider in the component tree.
- **AC9:** IF the dynamic import fails (network error), THE `Web3ErrorBoundary` SHALL catch it and show the retry UI.

---

## Scope

**IN:**
- `src/app/[locale]/layout.tsx` — cambiar import estático a `next/dynamic`
- `src/shared/providers/Web3Provider.tsx` — mínimos cambios si necesario para compatibilidad

**OUT:**
- No mover `wagmiConfig` ni el árbol interno de providers
- No tocar rutas de API
- No modificar componentes consumidores de contexto Web3
- No mover Web3Provider fuera del root layout (fuera de scope de este ticket)

---

## Dependencias

**Aplicar DESPUÉS de WAS-256** — ambas tocan `layout.tsx`. Merge WAS-256 primero para evitar conflicto.

---

## Rollback

`git revert` del commit restaura el import estático. Sin cambio de schema ni comportamiento funcional.
