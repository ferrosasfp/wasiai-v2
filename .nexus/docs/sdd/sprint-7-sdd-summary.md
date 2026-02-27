# Sprint 7 — Resumen SDDs para SPEC_APPROVED

**Generado por:** Architect (BMAD Method v6) · 2026-02-27  
**Estado global:** Pendiente SPEC_APPROVED de Fer

---

## Resumen ejecutivo

6 HUs del Sprint 7 tienen SDDs completos. Ninguna requiere cambios de contrato ni DB. Son todas UI/frontend con un pequeño toque en el service de Supabase (HU-4.2). Todas son implementables directamente desde los SDDs sin ambigüedades.

---

## Tabla de SDDs

| ID | Título | Tamaño | Archivo | Dependencias | Veredicto |
|----|--------|--------|---------|-------------|-----------|
| WAS-45 | Wallet connect/disconnect en NavBar | S | `sdd-WAS-45.md` | Ninguna | ✅ Implementable |
| WAS-46 | BUG: Pay sin wallet → abrir modal | XS | `sdd-WAS-46.md` | **Requiere WAS-45** | ✅ Implementable post-WAS-45 |
| WAS-47 | "Ver agentes" scroll suave en home | XS | `sdd-WAS-47.md` | Ninguna | ✅ Implementable |
| HU-9.1 | Empty state búsqueda sin resultados | S | `sdd-HU-9.1.md` | Ninguna | ✅ Implementable |
| HU-9.2 | Preview live en /publish | M | `sdd-HU-9.2.md` | Ninguna | ✅ Implementable |
| HU-4.2 | Filtros avanzados marketplace | M | `sdd-HU-4.2.md` | Ninguna | ✅ Implementable |

---

## Detalle por HU

### WAS-45 — Wallet en NavBar (S ~1 día)

**Qué crea:**
- `src/features/payments/components/WalletConnectModal.tsx` — modal extraído de PayToCallButton, controlled via props `open/onClose/onConnected`
- `src/features/payments/components/WalletConnectButton.tsx` — botón navbar: "Connect Wallet" / dirección truncada + dropdown "Disconnect"
- `src/components/WasiNavBar.tsx` — integra WalletConnectButton en desktop y mobile

**Notas clave:** WasiNavBar ya es `'use client'`. No hay SSR issues. El modal usa el mismo filtro de deduplicación de connectors que ya existe en PayToCallButton. Estado 100% via wagmi (global).

**i18n:** 5 claves bajo `wallet.*` en `en.json` y `es.json`.

---

### WAS-46 — BUG: Pay sin wallet (XS ~2-3h, post-WAS-45)

**Qué modifica:**
- `src/features/payments/components/PayToCallButton.tsx`
  - Elimina el modal inline (lo reemplaza con `WalletConnectModal` de WAS-45)
  - Cambia `onClick={pay}` por `onClick={handlePayClick}` que verifica si hay wallet
  - Usa patrón `useRef` + `useEffect` para ejecutar `pay()` automáticamente post-conexión
  - Elimina imports huérfanos `useConnect` y `useConnectors`

**Garantías del fix:** Input del usuario preservado (useState local no se toca). Si cierra modal sin conectar → estado inicial sin errores. Race condition cubierta con ref pattern.

---

### WAS-47 — Scroll "Ver agentes" (XS ~30min)

**Qué modifica:**
- `src/features/home/components/HeroDualCard.tsx` — consumer CTA cambia de `<Link href="/{locale}">` a `<a>` con lógica de scroll

**Hallazgo:** `id="agents"` **ya existe** en `page.tsx` (línea 91). Solo falta cambiar el CTA. Cero cambios en page.tsx.

**Lógica:** Si pathname es home → `scrollIntoView({ behavior: 'smooth' })`. Si es otra ruta → navega a `/{locale}#agents`. HeroDualCard ya es `'use client'`.

---

### HU-9.1 — Empty state búsqueda (S ~4h)

**Qué crea:**
- `src/features/models/components/EmptySearchState.tsx` — Server Component puro que recibe textos como props

**Qué modifica:**
- `src/app/[locale]/page.tsx` — segunda llamada condicional a `getModels({ limit: 4 })` para sugeridos. Solo ocurre cuando `models.length === 0 && search`. Reemplaza el empty state básico actual con `EmptySearchState`.

**Casos cubiertos:**
- Búsqueda sin resultados → EmptySearchState con mensaje + hasta 4 sugeridos
- Category + búsqueda sin resultados → mensaje adicional sobre categoría
- Sugeridos también vacíos → EmptySearchState sin sección de sugeridos (sin crash)
- Marketplace vacío sin búsqueda → mantiene comportamiento actual sin cambios

**i18n:** 5 claves bajo `home.emptySearch.*`.

---

### HU-9.2 — Preview live en /publish (M ~1 día)

**Qué crea:**
- `src/features/publish/components/PublishPreview.tsx` — Client Component con toggle mobile y ModelCard no interactivo

**Qué modifica:**
- `src/features/models/components/ModelCard.tsx` — 3 defaults defensivos: `name ?? 'Sin nombre'`, `total_calls ?? 0`, `price_per_call ?? 0`
- `src/app/[locale]/publish/PublishForm.tsx` — layout convertido a grid 2 columnas (`lg:grid-cols-[1fr_380px]`), panel preview sticky en desktop, max-width ajustado a 5xl

**Riesgo resuelto:** PublishForm **ya es `'use client'`** — verificado en codebase. Sin conversión necesaria. El riesgo alto del S0 no aplica.

**Nota:** `AgentCardPreview` ya existe en el codebase pero AC #7 requiere usar `ModelCard`. Sin conflicto — PublishPreview usa ModelCard directamente con `pointer-events-none`.

---

### HU-4.2 — Filtros avanzados marketplace (M ~1 día)

**Qué crea:**
- `src/features/models/components/FilterPanel.tsx` — Client Component unificado con categoría (chips), tipo de agente (chips), precio máximo (input number), botón "Limpiar filtros" condicional

**Qué modifica:**
- `src/features/models/services/models.service.ts` — agrega `agent_type` (`.eq()`) y `max_price` (`.lte()`) al query Supabase de `getModels`
- `src/app/[locale]/page.tsx` — lee `agent_type` y `max_price` de searchParams, los pasa a getModels, los incluye en `pageHref`
- `src/features/models/components/CategoryFilter.tsx` — eliminar e importar desde FilterPanel (o re-exportar)

**Decisión clave:** El service consulta Supabase directamente (no el API route `/api/v1/agents`). Los filtros se implementan en el query builder de Supabase, no como proxy HTTP. Más eficiente, más simple.

**i18n:** ~10 claves bajo `filters.*` en `en.json` y `es.json`.

---

## Orden de implementación recomendado

```
1. WAS-47     (30 min, independiente, cero riesgo — buen calentamiento)
2. WAS-45     (S, independiente — crea WalletConnectModal que WAS-46 necesita)
3. WAS-46     (XS, depende de WAS-45 — PR conjunto recomendado)
4. HU-9.1     (S, independiente — solo UI)
5. HU-4.2     (M, independiente — mayor impacto en discovery)
6. HU-9.2     (M, independiente — último porque requiere ajuste de layout)
```

---

## Cambios en DB / contratos

| HU | DB | Contratos | API routes |
|----|-----|-----------|------------|
| WAS-45 | ❌ | ❌ | ❌ |
| WAS-46 | ❌ | ❌ | ❌ |
| WAS-47 | ❌ | ❌ | ❌ |
| HU-9.1 | ❌ | ❌ | ❌ |
| HU-9.2 | ❌ | ❌ | ❌ |
| HU-4.2 | ❌ | ❌ | ❌ (service directo a Supabase) |

**Conclusión:** Sprint 7 es 100% frontend. Sin migrations. Sin contratos. Riesgo de regresión bajo.

---

## Archivos nuevos creados en Sprint 7

```
src/features/payments/components/WalletConnectModal.tsx  (WAS-45)
src/features/payments/components/WalletConnectButton.tsx (WAS-45)
src/features/models/components/EmptySearchState.tsx      (HU-9.1)
src/features/models/components/FilterPanel.tsx           (HU-4.2)
src/features/publish/components/PublishPreview.tsx       (HU-9.2)
```

## Archivos modificados en Sprint 7

```
src/components/WasiNavBar.tsx                            (WAS-45)
src/features/payments/components/PayToCallButton.tsx     (WAS-46)
src/features/home/components/HeroDualCard.tsx            (WAS-47)
src/app/[locale]/page.tsx                                (HU-9.1, HU-4.2)
src/features/models/components/ModelCard.tsx             (HU-9.2)
src/app/[locale]/publish/PublishForm.tsx                 (HU-9.2)
src/features/models/services/models.service.ts           (HU-4.2)
src/features/models/components/CategoryFilter.tsx        (HU-4.2 — eliminar o re-exportar)
src/messages/en.json                                     (WAS-45, HU-9.1, HU-9.2, HU-4.2)
src/messages/es.json                                     (WAS-45, HU-9.1, HU-9.2, HU-4.2)
```

---

*Listos para SPEC_APPROVED. Cada SDD está autocontenido — el dev puede implementar directamente sin consultar este resumen.*

*Architect (BMAD v6) · Sprint 7 · 2026-02-27*
