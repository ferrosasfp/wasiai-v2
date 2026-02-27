# Sprint 7 — QA Report

**Fecha:** 2026-02-27  
**QA Agent:** BMAD QA v6  
**Build:** `npm run build` → ✅ Sin errores, sin warnings ESLint  
**ethers.js imports nuevos:** ✅ NINGUNO detectado  
**i18n cubierto:** ✅ en.json + es.json actualizados para todas las stories

---

## WAS-45: Wallet connect/disconnect en WasiNavBar

### AC-1: La navbar muestra botón "Connect Wallet" cuando no hay wallet conectada
✅ CUMPLE — `WalletConnectButton.tsx`: cuando `!isConnected` renderiza botón con `{t('connectWallet')}`. Importado en `WasiNavBar.tsx` línea 10.

### AC-2: Modal con connectors disponibles (deduplicados, sin "Injected" raw)
✅ CUMPLE — `WalletConnectModal.tsx`: filtro exacto `arr.findIndex(x => x.name === c.name) === i && c.name !== 'Injected'`.

### AC-3: Dirección truncada + indicador visual de red activa cuando conectado
✅ CUMPLE — `WalletConnectButton.tsx`: `truncateAddress()` retorna `${addr.slice(0, 6)}...${addr.slice(-4)}`. Badge verde `bg-green-400` / amarillo `bg-yellow-400`.

### AC-4: Click en dirección truncada → dropdown con "Disconnect"
✅ CUMPLE — Botón activa `setDropdownOpen(!dropdownOpen)`, dropdown renderiza con `{t('disconnect')}`.

### AC-5: Al desconectar vuelve a "Connect Wallet" sin recargar
✅ CUMPLE — `disconnect()` de wagmi; wagmi re-renderiza el componente automáticamente al cambiar `isConnected`.

### AC-6: Estado de wallet global via wagmi — PayToCallButton detecta cambio automáticamente
✅ CUMPLE — `PayToCallButton.tsx` línea 20: `const { address } = useAccount()`. Estado global wagmi, sin useState local duplicado.

### AC-7: Mobile — botón de wallet en hamburger menu
✅ CUMPLE — `WasiNavBar.tsx` línea 230: `<WalletConnectButton locale={locale} />` dentro de `div#mobile-menu` con clase `sm:hidden`.

### AC-8: Red incorrecta → badge amarillo sin bloquear navegación
✅ CUMPLE — `isWrongNetwork = isConnected && chain?.id !== FUJI_CHAIN_ID` → badge amarillo + texto `{t('wrongNetwork')}`. No hay bloqueo de navegación.

**i18n wallet.* en en.json:** ✅ `connectWallet`, `disconnect`, `selectWallet`, `cancel`, `wrongNetwork`  
**i18n wallet.* en es.json:** ✅ Equivalentes en español

### Veredicto WAS-45: ✅ APROBADO

---

## WAS-46: BUG — Botón Pay debe conectar wallet cuando no hay wallet

### AC-1: Click "Pay" sin wallet → muestra WalletConnectModal (no ejecuta pay())
✅ CUMPLE — `PayToCallButton.tsx` línea 62: `handlePayClick()` → `if (!address) { setShowWalletModal(true); return }`.

### AC-2: Post-conexión → flujo de pago continúa automáticamente
✅ CUMPLE — `useEffect` línea 47: `if (address && pendingPayRef.current) { pendingPayRef.current = false; pay() }`. `handleWalletConnected` (línea 71) setea `pendingPayRef.current = true`.

### AC-3: Botón "Pay" NUNCA ejecuta pay() sin wallet conectada
✅ CUMPLE — `handlePayClick` guarda contra `!address` antes de llamar `pay()`.

### AC-4: Input del usuario preservado durante conexión
✅ CUMPLE — El componente no se desmonta; `useState` local de `input` sobrevive el flujo de modal.

### AC-5: Cerrar modal sin conectar → estado inicial sin error/loading
✅ CUMPLE — `onClose={() => setShowWalletModal(false)}`. `pendingPayRef.current` queda `false`, sin efecto.

### AC-6: Test de aceptación manual
⚠️ PARCIAL — No verificable automáticamente (requiere browser real + MetaMask). Lógica del código es correcta y determinística. Marcado para verificación manual en staging.

**Cleanup imports:** ✅ `PayToCallButton.tsx` línea 4 importa solo `useAccount, useDisconnect` de wagmi. `useConnect` y `useConnectors` eliminados.

### Veredicto WAS-46: ✅ APROBADO (AC-6 requiere prueba manual en staging)

---

## WAS-47: Botón "Ver agentes" hace scroll suave

### AC-1: Botón "Ver agentes" hace scroll suave a sección de agentes
✅ CUMPLE — `HeroDualCard.tsx` línea 119: `document.getElementById('agents')?.scrollIntoView({ behavior: 'smooth' })`.

### AC-2: Scroll usa behavior: 'smooth' nativo
✅ CUMPLE — `{ behavior: 'smooth' }` explícito en la llamada.

### AC-3: Sección de agentes tiene id="agents"
✅ CUMPLE — `page.tsx` línea 113: `<section id="agents" className="px-6 py-12">`. No modificado (ya existía).

### AC-4: Mobile funciona igual que desktop
✅ CUMPLE — `scrollIntoView` es nativo del DOM, aplica en todos los viewports sin condición de breakpoint.

### AC-5: Desde otra ruta navega a /${locale}#agents
✅ CUMPLE — `href={/${locale}#agents}` con `e.preventDefault()` solo cuando `isHome === true`. En otras rutas, el `<a>` navega normalmente al anchor.

### Veredicto WAS-47: ✅ APROBADO

---

## HU-9.1: Empty state cuando búsqueda retorna 0 resultados

### AC-1: models.length === 0 + search activo → muestra EmptySearchState
✅ CUMPLE — `page.tsx` línea 49 condición `models.length === 0 && search`. JSX renderiza `<EmptySearchState>` en ese caso.

### AC-2: EmptySearchState muestra icono + mensaje + sugerencia
✅ CUMPLE — `EmptySearchState.tsx`: `🔍` icono, `{texts.noResults}`, `{texts.suggestion}`. Textos interpolados desde `page.tsx`.

### AC-3: Hasta 4 agentes sugeridos desde endpoint sin filtros
✅ CUMPLE — `page.tsx` línea 49: `(await getModels({ limit: 4, offset: 0 })).models`. Solo se ejecuta cuando `models.length === 0 && search`.

### AC-4: Botón "Ver todos los agentes" limpia búsqueda
✅ CUMPLE — `clearHref={/${locale}}` (sin query params). Limpiar search + category.

### AC-5: Si hay filtro de categoría activo → mensaje adicional visible
✅ CUMPLE — `EmptySearchState.tsx`: `{category && texts.alsoTryClearCategory && <p>...</p>}`.

### AC-6: Traducciones en es/en
✅ CUMPLE — `emptySearch.*` presente en ambos archivos: `noResults`, `suggestion`, `alsoTryClearCategory`, `viewAll`, `popularAgents`.

### AC-7: Sugeridos vacíos → empty state sin sección sugeridos (sin crash)
✅ CUMPLE — `{suggestedModels.length > 0 && <div>...</div>}` condicional.

### AC-8: Sin search activo → mantiene comportamiento original
✅ CUMPLE — Condición `search ?` en JSX de `page.tsx`. Sin search activo → bloque `else` con empty state original.

### Veredicto HU-9.1: ✅ APROBADO

---

## HU-9.2: Preview live en /publish

### AC-1: Panel lateral (desktop) / sección inferior (mobile) con ModelCard en tiempo real
✅ CUMPLE — `PublishForm.tsx` línea 215: `grid gap-8 lg:grid-cols-[1fr,320px]`. `PublishPreview.tsx` importado y renderizado en columna derecha.

### AC-2: Preview se actualiza con cada keystroke (debounce ≤ 200ms)
✅ CUMPLE — `previewData` derivado directamente del `data` state de React. Cada `setData()` → re-render inmediato → `PublishPreview` recibe nuevos props → `ModelCard` actualizada. Sin debounce adicional (React re-render nativo < 16ms).

### AC-3: Campos reflejados: nombre, descripción, precio, categoría, agent_type, slug, imagen
✅ CUMPLE — `previewData` en `PublishForm.tsx` línea 173 incluye: `name`, `description`, `category`, `price_per_call`, `agent_type`, `cover_image`, `slug: draftSlug ?? undefined`.

### AC-4: Campo vacío → placeholder en gris, sin error, sin crash
✅ CUMPLE — `PublishPreview.tsx` construye `previewModel` con defaults seguros. `ModelCard.tsx` tiene 3 defaults defensivos: `model.name ?? 'Sin nombre'`, `model.total_calls ?? 0`, `(model.price_per_call ?? 0).toFixed(2)`.

### AC-5: Preview etiquetada como "Vista previa" con badge visible
✅ CUMPLE — `PublishPreview.tsx`: badge `rounded-full bg-avax-50 border border-avax-100` con `{previewLabel}`.

### AC-6: Mobile collapsible (colapsado por defecto)
✅ CUMPLE — `const [collapsed, setCollapsed] = useState(true)`. Botón toggle `sm:hidden`. `hidden sm:block` cuando colapsado.

### AC-7: Usa exactamente ModelCard del marketplace (sin duplicación)
✅ CUMPLE — `PublishPreview.tsx` línea 3: `import { ModelCard } from '@/features/models/components/ModelCard'`. No hay código duplicado.

**i18n preview.* en publish.*:** ✅ en.json y es.json tienen `label`, `show`, `hide` dentro de `"publish".preview`.

### Veredicto HU-9.2: ✅ APROBADO

---

## HU-4.2: Filtros avanzados en marketplace

### AC-1: Panel de filtros con categoría, tipo de agente, precio máximo
✅ CUMPLE — `FilterPanel.tsx`: chips de CATEGORIES (7 opciones), chips de AGENT_TYPES (5 opciones), input `type="number"` para precio máximo. Renderizado en `page.tsx` línea 128.

### AC-2: Filtros acumulables (categoría + tipo + precio en misma query)
✅ CUMPLE — `models.service.ts` líneas 31-33: aplica `.eq('category')`, `.eq('agent_type')`, `.lte('price_per_call')` encadenados sobre la misma query de Supabase.

### AC-3: URL refleja filtros como query params (back/forward compatible)
✅ CUMPLE — `FilterPanel.tsx`: `updateFilters()` usa `router.push(${pathname}?${params.toString()})`. `page.tsx` lee `searchParams.agent_type` y `searchParams.max_price`.

### AC-4: Botón "Limpiar filtros" visible solo con filtros activos; preserva search
✅ CUMPLE — `hasActiveFilters` condicional. `clearAll()` elimina `category`, `agent_type`, `max_price`, `page` pero NO elimina `search`.

### AC-5: Tipos de agente disponibles: llm, rag, tool, multimodal, code como chips
✅ CUMPLE — `AGENT_TYPES` array en `FilterPanel.tsx` con los 5 valores requeridos mostrados como botones chip con toggle.

### AC-6: Precio máximo acepta 0-10 USDC con pasos de 0.10
✅ CUMPLE — `<input type="number" min="0" max="10" step="0.10" ... />`.

### AC-7: Sin full page reload (router.push)
✅ CUMPLE — `FilterPanel.tsx` usa `useRouter` de next/navigation con `router.push()`.

### AC-8: Traducciones en es/en
✅ CUMPLE — `filters.*` en ambos archivos: `category`, `agentType`, `maxPrice`, `clearFilters`, `all`, `types.*`.

### AC-9: Zero cambios de backend — service usa Supabase directamente
✅ CUMPLE — `models.service.ts` modificado con filtros Supabase. `src/app/api/v1/agents/route.ts` no tocado (verificado: no aparece en ningún diff del sprint).

**CategoryFilter.tsx:** ✅ Re-exportado como alias de FilterPanel para compatibilidad. Otros imports no rompen.

### Veredicto HU-4.2: ✅ APROBADO

---

## Resumen del Sprint 7

| Story | Prioridad | Veredicto |
|-------|-----------|-----------|
| WAS-45: Wallet connect en NavBar | P1 | ✅ APROBADO |
| WAS-46: Pay → conectar wallet auto | P0 | ✅ APROBADO |
| WAS-47: Scroll suave "Ver agentes" | P3 | ✅ APROBADO |
| HU-9.1: Empty state búsqueda | P2 | ✅ APROBADO |
| HU-9.2: Preview live en /publish | P2 | ✅ APROBADO |
| HU-4.2: Filtros avanzados marketplace | P2 | ✅ APROBADO |

## Checks globales

| Check | Resultado |
|-------|-----------|
| `npm run build` | ✅ Sin errores TypeScript |
| ESLint (--max-warnings 0) | ✅ Sin warnings |
| ethers.js imports nuevos | ✅ Ninguno |
| i18n en.json completo | ✅ wallet.*, emptySearch.*, filters.*, publish.preview.* |
| i18n es.json completo | ✅ Equivalentes en español |

## Veredicto Final del Sprint 7: ✅ SPRINT APROBADO

**6/6 historias APROBADAS.** Build limpio. Sin regresiones detectadas.

> **Nota:** AC-6 de WAS-46 (test manual end-to-end con MetaMask real) debe verificarse en staging antes del release a producción. La lógica de código es determinística y correcta, pero la integración con el proveedor de wallet real requiere prueba humana.
