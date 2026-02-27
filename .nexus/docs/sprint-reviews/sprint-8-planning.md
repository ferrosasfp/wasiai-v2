# Sprint 8 — Planning Document
**SM:** Bob (BMAD v6)  
**Fecha de planning:** 2026-02-27  
**Sprint:** 8 | 2026-03-07 → 2026-03-14  
**Tema:** Mobile UX & Discovery Quality  
**Estado:** PENDIENTE HU_APPROVED de Fer  

---

## Contexto del Sprint

Sprint 7 cerró limpio: 6/6 historias aprobadas, build sin errores, QA firmado. El backlog ahora tiene dos frentes abiertos:

1. **Mobile UX** — La navegación en mobile sigue siendo un drawer hamburguesa, patrón no estándar en dApps. Cualquier usuario que llegue al marketplace desde mobile tiene fricción innecesaria.
2. **Discovery Quality** — Con filtros y búsqueda ya funcionando (Sprint 7), el siguiente nivel es que las fichas de agentes muestren información confiable: métricas reales, ejemplos de uso, y comparación directa entre agentes.

Sprint 8 ataca ambos frentes en orden de impacto.

---

## HU-MOBILE-NAV — Bottom Navigation Bar en Mobile 🔴 P0

> **Esta es la HU más crítica del sprint.**

### Historia de usuario

> Como usuario de WasiAI navegando desde un teléfono, quiero una barra de navegación inferior con las 5 secciones principales del marketplace, para poder navegar con el pulgar sin tener que abrir un menú hamburguesa cada vez.

### Por qué P0

El drawer hamburguesa es el patrón más roto en mobile Web3. Todos los marketplaces serios (OpenSea, Uniswap, Blur) usan bottom nav. Esta HU convierte WasiAI de "webapp responsiva" a "dApp mobile-first". Es la base sobre la que se construye HU-3.2 (playground comparativo necesita ser usable en mobile).

### Acceptance Criteria

| # | Criterio | Verificable |
|---|----------|-------------|
| AC-1 | En viewports < 640px, la barra inferior con 5 tabs reemplaza al drawer hamburguesa. Tabs: 🏠 Home (`/`), 🔍 Explorar (`/explore`), ➕ FAB central (`/publish`), 📊 Dashboard (condicional), 👤 Perfil | Test visual 375px |
| AC-2 | El botón ➕ es un FAB elevado (shadow-lg, z-50), circular, mayor que los tabs, color AVAX red `#E84142` | Screenshot mobile |
| AC-3 | Click en ➕ → navega a `/[locale]/publish` | Cypress/manual |
| AC-4 | Tab activo: color `#E84142`. Tab inactivo: `text-gray-500 dark:text-gray-400` | Test visual |
| AC-5 | Safe area iOS: la barra tiene `padding-bottom: env(safe-area-inset-bottom)` para no quedar detrás del home indicator | Safari iOS real |
| AC-6 | Header en mobile simplificado: solo logo WasiAI + `WalletConnectButton`. Sin hamburguesa, sin links de nav, sin otros elementos | Test visual 375px |
| AC-7 | En desktop ≥ 640px: navbar existente sin cambios. La barra inferior NO aparece. | Test visual 1280px |
| AC-8 | Tab Dashboard: creator → `/creator/dashboard` \| consumer → `/dashboard` \| no auth → `/auth` | Test con 3 estados de usuario |
| AC-9 | Tab Perfil: autenticado → `/[locale]/profile` \| no auth → `/auth` | Test con/sin auth |
| AC-10 | Todos los labels tienen traducciones en es/en bajo las claves `mobileNav.*` | grep en.json + es.json |

### Scope

**Archivos a crear:**
- `src/components/MobileBottomNav.tsx` — componente principal (client component)

**Archivos a modificar:**
- `src/components/WasiNavBar.tsx` — en mobile: mostrar solo logo + WalletConnectButton; ocultar hamburguesa (clase `hidden sm:flex` o similar)
- `src/app/[locale]/layout.tsx` — incluir `<MobileBottomNav />` después del `<main>`, fuera del flujo de scroll, `sticky bottom-0`
- `src/messages/en.json` — agregar `"mobileNav": { "home": "Home", "explore": "Explore", "publish": "Publish", "dashboard": "Dashboard", "profile": "Profile" }`
- `src/messages/es.json` — equivalentes en español
- `src/hooks/useIsCreator.ts` — hook que consulta si el usuario autenticado tiene perfil de creator (puede reutilizar lógica existente del creator dashboard)

**Archivos NO tocar:**
- Contrato Solidity
- Cualquier componente desktop que funcione bien hoy
- API routes

### Estructura del componente

```typescript
// MobileBottomNav.tsx — esquema lógico
'use client'

const tabs = [
  { icon: HomeIcon,    key: 'home',      href: '/' },
  { icon: SearchIcon,  key: 'explore',   href: '/explore' },
  { icon: PlusIcon,    key: 'publish',   href: '/publish', isFAB: true },
  { icon: ChartIcon,   key: 'dashboard', href: '/dashboard', dynamic: true },
  { icon: UserIcon,    key: 'profile',   href: '/profile' },
]

// Dashboard href: useIsCreator() → '/creator/dashboard' | '/dashboard'
// Tabs inactivos: text-gray-500
// Tab activo (usePathname()): text-[#E84142]
// FAB: bg-[#E84142] rounded-full shadow-lg p-4 z-50 -mt-6
// Wrapper: fixed bottom-0 w-full bg-white dark:bg-gray-900 border-t
//          pb-[env(safe-area-inset-bottom)] sm:hidden
```

### Estimación: M (3-5 horas de desarrollo)

### Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Safe area no funciona en Safari iOS sin `viewport-fit=cover` | Media | Verificar que `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` existe en `layout.tsx` antes de implementar |
| FAB se solapa con contenido fixed (ej: modales, cookie banner) | Baja | Auditar z-index del proyecto. FAB usa z-50, modales deben usar z-60+ |
| `useIsCreator` hace query en cada render de navegación | Media | Usar `useSWR` con cache o `React.cache` server-side. Sin SWR nuevo — usar fetch nativo con revalidate |
| WalletConnectButton en header mobile duplica lógica con bottom nav | Baja | El header mobile solo muestra WalletConnectButton. La bottom nav no tiene wallet — patrón correcto |

---

## HU-3.2 — Playground Comparativo 🟠 P1

### Historia de usuario

> Como consumer evaluando agentes del marketplace, quiero poder probar y comparar múltiples agentes con el mismo input en un panel lado a lado, para elegir el mejor agente para mi caso de uso sin hacer múltiples tabs.

### Acceptance Criteria

| # | Criterio | Verificable |
|---|----------|-------------|
| AC-1 | Existe una ruta `/[locale]/compare` (o modal accesible desde las fichas de agentes) con el playground comparativo | Navegación |
| AC-2 | El usuario puede seleccionar 2 o más agentes para comparar (mínimo 2, máximo 4 simultáneos) | Test con 2, 3, 4 agentes |
| AC-3 | Hay un campo de input único (shared) — el mismo prompt se envía a todos los agentes seleccionados | Test de sincronización |
| AC-4 | Al hacer clic en "Comparar", se invocan todos los agentes seleccionados en paralelo (Promise.all o similar) | Network tab |
| AC-5 | Las respuestas se muestran en paneles side-by-side con: nombre del agente, respuesta, latencia en ms, precio por llamada | Screenshot |
| AC-6 | Cada panel muestra el estado de carga individual (spinner mientras espera respuesta) | Test visual |
| AC-7 | Si un agente falla, su panel muestra el error sin afectar los demás | Test con agente con endpoint inválido |
| AC-8 | El playground usa el free trial disponible (HU-3.1) — si ya se agotó, muestra el botón de pago | Test con trial agotado |
| AC-9 | En mobile (con nueva bottom nav), la vista se adapta: scroll horizontal entre paneles en lugar de side-by-side | Test 375px |
| AC-10 | Hay un botón "Agregar agente al comparador" en cada ficha del marketplace | Test en ModelCard |
| AC-11 | Los agentes seleccionados persisten en sessionStorage — si el usuario navega y vuelve, los agentes siguen seleccionados | Test de navegación |
| AC-12 | Traducciones en es/en para toda la UI del comparador | grep claves |

### Scope

**Archivos a crear:**
- `src/app/[locale]/compare/page.tsx` — página del playground comparativo
- `src/features/compare/components/ComparePanel.tsx` — panel individual por agente
- `src/features/compare/components/CompareInput.tsx` — input compartido
- `src/features/compare/hooks/useCompare.ts` — lógica de estado y llamadas paralelas
- `src/features/compare/store/compareStore.ts` — sessionStorage con agentes seleccionados (sin Zustand nuevo — usar localStorage hook simple)

**Archivos a modificar:**
- `src/features/models/components/ModelCard.tsx` — agregar botón "Comparar" que añade al store
- `src/messages/en.json` / `src/messages/es.json` — claves `compare.*`

### Estimación: L (6-10 horas de desarrollo)

**Nota:** HU-3.2 depende de que HU-MOBILE-NAV esté al menos en review para que la UX mobile del comparador sea coherente con la nueva navegación.

### Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Invocar 4 agentes en paralelo puede ser lento si los endpoints son lentos | Alta | Timeout de 15s por agente. Mostrar respuestas incrementales (cada panel actualiza cuando llega su respuesta) |
| El free trial es 1 por usuario/agente — comparar 4 agentes gasta 4 trials | Media | Mostrar aviso antes de lanzar: "Esto usará tu free trial en X agentes. ¿Continuar?" |
| Mobile side-by-side con 4 paneles es inusable | Alta | En < 640px: horizontal scroll snap. Máximo 2 paneles recomendado en mobile (warning si seleccionan 3+) |
| sessionStorage se limpia al cerrar tab — usuario pierde selección | Baja | Documentado en la UI. Aceptable para MVP. |

---

## HU-4.4 — Reputación con Datos Reales 🟠 P1

### Historia de usuario

> Como consumer evaluando un agente, quiero ver en la ficha las métricas reales de uptime, latencia p50/p95 y tasa de error calculadas desde las llamadas reales, para poder evaluar si el agente es confiable antes de pagar.

### Acceptance Criteria

| # | Criterio | Verificable |
|---|----------|-------------|
| AC-1 | La ficha de cada agente muestra: uptime % (últimas 24h), latencia p50 en ms, latencia p95 en ms, tasa de error % | Screenshot ficha |
| AC-2 | Las métricas se calculan desde la tabla `agent_calls` real — sin datos hardcodeados ni simulados | Query SQL verificable |
| AC-3 | Si un agente tiene 0 llamadas reales, muestra "Sin datos" o "—" en lugar de 0% o 0ms | Test con agente nuevo |
| AC-4 | Las métricas se actualizan máximo cada 1 hora (cached en Supabase o server-side cache) — no se recalculan en cada page view | Verificar en APM/logs |
| AC-5 | El diseño visual de las métricas es coherente con el resto de la ficha (misma tipografía, colores del sistema de diseño) | Design review |
| AC-6 | Uptime < 95%: badge rojo. 95-99%: badge amarillo. ≥ 99%: badge verde | Test con 3 rangos |
| AC-7 | En la ModelCard del marketplace (listado), se muestra solo el uptime % como badge compacto | Screenshot listado |
| AC-8 | En la página de detalle del agente (`/agents/[slug]`), se muestran todas las métricas completas | Screenshot detalle |
| AC-9 | Traducciones en es/en para labels de métricas | grep claves |

### Scope

**Archivos a crear:**
- `src/features/models/components/ReputationBadge.tsx` — badge compacto (para ModelCard)
- `src/features/models/components/ReputationMetrics.tsx` — panel completo (para detalle)
- `src/lib/reputation.ts` — funciones de cálculo: `getAgentReputation(agentId)` con cache

**Archivos a modificar:**
- `src/features/models/components/ModelCard.tsx` — agregar `<ReputationBadge>`
- `src/app/[locale]/agents/[slug]/page.tsx` — agregar `<ReputationMetrics>`
- `src/messages/en.json` / `src/messages/es.json` — claves `reputation.*`

### Query de base (referencia para Dev)

```sql
-- Uptime: % de llamadas exitosas en últimas 24h
SELECT 
  COUNT(*) FILTER (WHERE status = 'success') * 100.0 / NULLIF(COUNT(*), 0) AS uptime_pct,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms) AS p50_ms,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_ms,
  COUNT(*) FILTER (WHERE status = 'error') * 100.0 / NULLIF(COUNT(*), 0) AS error_rate_pct
FROM agent_calls
WHERE agent_id = $1
  AND created_at > NOW() - INTERVAL '24 hours'
```

### Estimación: M (3-5 horas de desarrollo)

### Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Agentes con pocos datos dan métricas no representativas | Alta | Mostrar "Basado en N llamadas" junto a las métricas. Si N < 10 → "Datos insuficientes" |
| PERCENTILE_CONT no disponible en todos los planes de Supabase | Baja | Es SQL estándar de Postgres. Verificar que no hay restricción en el plan free. Fallback: AVG si falla |
| Recalcular en cada request puede ser costoso con muchas llamadas | Media | Server-side cache con `unstable_cache` de Next.js, revalidate: 3600 (1 hora) |

---

## HU-4.3 — Ejemplos Input/Output Curados 🟡 P2

### Historia de usuario

> Como creator con un agente publicado, quiero poder agregar hasta 5 ejemplos reales de input/output a mi agente, para que los consumers vean exactamente qué hace mi agente antes de probar el trial.

### Acceptance Criteria

| # | Criterio | Verificable |
|---|----------|-------------|
| AC-1 | En el dashboard del creator (edición de agente), hay una sección "Ejemplos de uso" con hasta 5 pares input/output | Screenshot creator |
| AC-2 | Cada ejemplo tiene: campo "Input" (textarea, max 500 chars) y campo "Output esperado" (textarea, max 1000 chars) y un label opcional (max 60 chars) | Test de validación |
| AC-3 | El creator puede agregar, editar y eliminar ejemplos | CRUD completo |
| AC-4 | Los ejemplos se guardan en una tabla `agent_examples` en Supabase con RLS (solo el creator puede editar sus ejemplos) | Migration + RLS policy |
| AC-5 | En la ficha pública del agente, los ejemplos se muestran en un accordion o tabs: consumer puede expandir cada ejemplo | Screenshot ficha pública |
| AC-6 | Si el agente no tiene ejemplos, la sección no aparece en la ficha pública (no hay empty state vacío) | Test sin ejemplos |
| AC-7 | Los ejemplos son opcionales — el agente puede publicarse sin ejemplos | Test de publicación sin ejemplos |
| AC-8 | Traducciones en es/en para toda la UI de ejemplos | grep claves |
| AC-9 | La migration de `agent_examples` sigue la convención: `017_agent_examples.sql` | Verificar nombre de archivo |

### Scope

**Archivos a crear:**
- `supabase/migrations/017_agent_examples.sql` — tabla + RLS + índice
- `src/features/creator/components/AgentExamples.tsx` — editor de ejemplos (creator)
- `src/features/models/components/AgentExamplesDisplay.tsx` — display público (accordion)
- `src/app/api/creator/agents/[id]/examples/route.ts` — CRUD endpoints (GET, POST, PUT, DELETE)

**Archivos a modificar:**
- `src/app/[locale]/creator/dashboard/page.tsx` o la página de edición de agente — incluir `<AgentExamples>`
- `src/app/[locale]/agents/[slug]/page.tsx` — incluir `<AgentExamplesDisplay>`
- `src/messages/en.json` / `src/messages/es.json` — claves `examples.*`

### Schema de la tabla

```sql
-- 017_agent_examples.sql
CREATE TABLE agent_examples (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  creator_id  UUID NOT NULL REFERENCES creator_profiles(id),
  label       TEXT,                    -- label opcional, max 60 chars
  input       TEXT NOT NULL,           -- max 500 chars (enforced en app)
  output      TEXT NOT NULL,           -- max 1000 chars (enforced en app)
  sort_order  INTEGER DEFAULT 0,       -- orden manual
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Máximo 5 ejemplos por agente (enforced en API, no en DB)
-- RLS
ALTER TABLE agent_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read" ON agent_examples
  FOR SELECT USING (true);

CREATE POLICY "Creator write" ON agent_examples
  FOR ALL USING (creator_id = auth.uid());

CREATE INDEX idx_agent_examples_agent_id ON agent_examples(agent_id, sort_order);
```

### Estimación: M (4-6 horas de desarrollo incluyendo migration)

### Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|------------|
| Migration 017 puede conflictuar si ya hay otra pending | Baja | Verificar que 017 está disponible (project-context.md dice "próxima: 017") ✅ |
| Creator sube ejemplos de mala calidad (spam, ofensivos) | Media | Max chars enforced en frontend y API. Moderación reactiva futura. |
| La página de edición de agente no existe como ruta dedicada | Media | Verificar si el creator edita desde `/creator/dashboard` o desde `/creator/agents/[id]/edit`. Adaptar según lo que exista. |

---

## Resumen del Sprint 8

| HU | Título | Prioridad | Tamaño | Dependencias | Gate |
|----|--------|-----------|--------|-------------|------|
| **HU-MOBILE-NAV** | Bottom nav bar mobile | P0 | M | WAS-45 ✅ | ⏳ HU_APPROVED |
| **HU-3.2** | Playground comparativo | P1 | L | HU-MOBILE-NAV | ⏳ HU_APPROVED |
| **HU-4.4** | Reputación datos reales | P1 | M | — | ⏳ HU_APPROVED |
| **HU-4.3** | Ejemplos input/output | P2 | M | — | ⏳ HU_APPROVED |

**Carga total estimada:** M + L + M + M = ~20-26 horas de desarrollo  
**Capacidad sprint (1 dev, 5 días):** ~25-30 horas → ✅ viable si no hay bloqueos

---

## Orden de implementación recomendado

```
Día 1-2:  HU-MOBILE-NAV (P0, base para mobile de todo lo demás)
Día 2-3:  HU-4.4 (independiente, puede ir en paralelo o tras nav)
Día 3-4:  HU-4.3 (independiente, migration + UI)
Día 4-5:  HU-3.2 (más grande, usa mobile nav ya implementada)
```

---

## DoD Global Sprint 8

- [ ] `npm run build` sin errores TypeScript
- [ ] ESLint `--max-warnings 0` limpio
- [ ] Adversarial review completado antes de cada commit
- [ ] Traducciones en es/en para toda nueva UI visible
- [ ] `git push origin master master:main`
- [ ] Safe area iOS testeada en Safari real (o BrowserStack iOS)
- [ ] `viewport-fit=cover` verificado en meta viewport antes de implementar HU-MOBILE-NAV
- [ ] Migration `017_agent_examples.sql` aplicada antes de HU-4.3 en staging

---

## Checklist de aprobación (HU_APPROVED)

Fer, para aprobar cada HU del Sprint 8 necesito que confirmes explícitamente:

- [ ] **HU-MOBILE-NAV aprobada** — los ACs de arriba son los correctos
- [ ] **HU-3.2 aprobada** — scope y ACs correctos
- [ ] **HU-4.4 aprobada** — scope y ACs correctos  
- [ ] **HU-4.3 aprobada** — scope y ACs correctos

Una vez que tengo HU_APPROVED de cada historia, el siguiente paso es S1 (Arquitecto/PO genera el SDD) y luego SM genera el story file antes de que Dev toque código.

---

*Generado por SM (Bob) — BMAD v6 — 2026-02-27*
