# Story File #017 — WAS-83: Admin panel wallet-only (sin Supabase auth)
> Architect · SPEC_APPROVED · 2026-03-01
> Dev SOLO lee este archivo. No consultar SDD ni Work Item.

---

## Goal
Eliminar la dependencia de sesión Supabase en `/en/admin`. La wallet address es la única identidad requerida. Sin wallet conectada → botón Connect. Sin permisos → "Access restricted". Con wallet owner/operator → acceso completo.

---

## Acceptance Criteria

| # | AC |
|---|---|
| AC1 | WHEN visitante accede sin wallet conectada, THE página SHALL mostrar botón "Connect Wallet" |
| AC2 | WHEN wallet conectada NO es owner ni operator, THE página SHALL mostrar "Access restricted" |
| AC3 | WHEN wallet ES owner u operator, THE panel SHALL cargar sin requerir sesión Supabase |
| AC4 | WHEN middleware procesa `/admin`, THE ruta NO SHALL ser bloqueada por Supabase auth |

---

## Archivos a modificar

| Archivo | Acción |
|---|---|
| `src/app/[locale]/admin/layout.tsx` | MODIFICAR — eliminar Supabase auth check |
| `src/app/[locale]/admin/page.tsx` | MODIFICAR — manejar estado sin wallet con botón Connect |

**middleware.ts — NO tocar** (ya no protege /admin)

---

## Wave 1 — admin/layout.tsx

### Reemplazar COMPLETAMENTE con:
```typescript
import type { ReactNode } from 'react'

/**
 * Layout del panel admin.
 * WAS-83: Sin dependencia de Supabase auth — wallet address es la identidad.
 * La verificación de owner/operator se hace en el cliente (admin/page.tsx).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {children}
    </div>
  )
}
```

⚠️ Eliminar imports de `createClient`, `redirect` y `next/navigation` — no deben quedar imports muertos.

---

## Wave 2 — admin/page.tsx

El estado "sin wallet" ya muestra `<span className="text-yellow-400">Connect wallet to manage</span>` (línea ~136). Hay que mejorarlo con un botón real de Connect Wallet.

Localizar el bloque:
```typescript
{isConnected ? (
  ...
) : (
  <span className="text-yellow-400">Connect wallet to manage</span>
)}
```

**Reemplazar el fallback** con:
```typescript
) : (
  <div className="flex flex-col items-center justify-center py-20 gap-4">
    <p className="text-gray-400 text-sm">Connect your wallet to access the admin panel</p>
    <w3m-button />
  </div>
)}
```

⚠️ Usar `WalletConnectButton` de `@/features/payments/components/WalletConnectButton` — es el componente oficial del proyecto. Ver cómo lo usa `WasiNavBar.tsx` para el prop `locale`.

---

## Wave 3 — Typecheck + commit

```bash
cd /home/ferdev/.openclaw/workspace/wasiai-v2
npx tsc --noEmit  # 0 errores

git add -A
git commit -m "feat(WAS-83): admin panel wallet-only — remove Supabase auth dependency"
git push origin master master:main
```

---

## Constraint Directives

**OBLIGATORIO:**
- `admin/layout.tsx` sin imports de Supabase ni next/navigation — layout puro
- Verificar el nombre exacto del botón Connect Wallet buscando en el codebase antes de usar `<w3m-button />`
- `npx tsc --noEmit` — 0 errores

**PROHIBIDO:**
- NO tocar `middleware.ts`
- NO tocar otras rutas protegidas (`/creator`, `/publish`, `/agent-keys`)
- NO agregar nueva lógica de auth — solo eliminar la de Supabase

## Escalation Rule
Si `WalletConnectButton` requiere props adicionales no disponibles en el admin page — usar el botón más simple disponible o un `<button>` nativo que llame `open()` de useAppKit.
