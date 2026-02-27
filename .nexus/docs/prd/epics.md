# WasiAI — Epics & Stories
> Fuente de verdad para el Sprint Planning BMAD.
> Sincronizado con BACKLOG.md — última actualización: 2026-02-26

---

## Epic 1: Creators Reales en el Marketplace

> Sin creators externos, no hay marketplace. Esta es LA prioridad de negocio.

### Story 1.1: Onboarding sin fricción
Publicar agente sin wallet ni USDC (custodial onboarding).

### Story 1.2: Formulario multi-paso
Básico → producto → técnico con preview live.

### Story 1.3: Test de endpoint en tiempo real
Test de endpoint desde el formulario con SSRF protection.

### Story 1.4: Creator analytics
Llamadas/día, latencia, earnings históricos, alertas de health.

### Story 1.5: Perfil público del creator
Página pública con todos los agentes del creator.

---

## Epic 2: SDK @wasiai/sdk

> Sin SDK, developers no pueden integrar. Multiplica el alcance 10x.

### Story 2.1: SDK Node.js TypeScript
`npm install @wasiai/sdk` — invoke, list, get, errores tipados.

### Story 2.2: SDK Python
`pip install wasiai` — paridad con SDK Node.js.

### Story 2.3: Documentación interactiva
Ejemplos ejecutables con el SDK real.

### Story 2.4: CLI wasiai
`wasiai invoke <agent> "<input>"` — developer experience desde terminal.

---

## Epic 3: Free Trial por Agente

> Sin esto, conversión es casi cero. Nadie paga por algo que no probó.

### Story 3.1: Una llamada gratuita por usuario por agente
Playground básico desde la ficha — 1 trial, rate limit, is_trial log.

### Story 3.2: Playground comparativo
Probar y comparar múltiples agentes lado a lado.

---

## Epic 4: Discovery y Calidad del Catálogo

### Story 4.1: Búsqueda semántica
pgvector o tsvector para búsqueda por semántica.

### Story 4.2: Filtros avanzados
Precio, latencia, uptime, categoría.

### Story 4.3: Ejemplos de input/output curados
El creator sube ejemplos reales de uso.

### Story 4.4: Reputación con datos reales
Uptime histórico, latencia p50/p95, tasa de error — reemplaza 👍/👎.

### Story 4.5: Colecciones curadas y featured agents
Curaduría editorial del marketplace.

---

## Epic 5: Agent-to-Agent Routing

> El diferenciador real. Ningún otro marketplace tiene esto.

### Story 5.1: POST /api/v1/compose — pipeline secuencial
Pipeline secuencial con pago x402 por paso.

### Story 5.2: Ejecución paralela de agentes
Múltiples agentes en paralelo dentro de un pipeline.

### Story 5.3: Routing inteligente
Por precio, latencia y reputación.

### Story 5.4: UI visual de pipelines
Constructor visual de pipelines de agentes.

---

## Epic 6: Mainnet Avalanche

> Mientras sea Fuji, es un juguete. Mainnet = producto real.

### Story 6.1: Auditoría de seguridad del contrato
Auditoría por firma externa antes de mainnet.

### Story 6.2: Deploy contrato en mainnet
Deploy + configurar operator wallet con AVAX real.

### Story 6.3: Migrar agentes demo a mainnet
Todos los agentes demo activos en mainnet.

### Story 6.4: Monitoring del operator wallet
Alerta cuando AVAX < umbral operativo.

---

## Epic 7: Integraciones con Ecosistema AI

### Story 7.1: Plugin LangChain
WasiAI como Tool nativo en LangChain.

### Story 7.2: Plugin LlamaIndex
Integración con LlamaIndex.

### Story 7.3: Ejemplo AgentKit Coinbase
Agente que paga agentes usando WasiAI.

### Story 7.4: Documentación MCP
Para Claude Desktop y Cursor.

---

## Epic 8: Transparencia y Confianza

### Story 8.1: Auditoría pública del contrato
Dashboard de auditoría accesible.

### Story 8.2: Dashboard público /transparency
Volumen, settlements, operator health.

### Story 8.3: Notificaciones
Email cuando saldo de key < 20%, uso inusual detectado.

### Story 8.4: Rate limiting configurable por creator
El creator puede proteger su endpoint de abuso.

---

## Epic 10: Mobile UX

> Sin mobile nav estándar, la dApp se siente a medias en el dispositivo donde más se usa crypto.

### Story 10.1: Bottom navigation bar en mobile (HU-MOBILE-NAV)

**Historia de usuario:**
> Como usuario de WasiAI en mobile, quiero una barra de navegación inferior estándar de dApp con acceso rápido a Home, Explorar, Publicar, Dashboard y Perfil, para navegar con el pulgar sin depender del drawer hamburguesa.

**Criticidad:** P0 — UX estándar dApp mobile. El drawer hamburguesa actual no es patrón de mercado.

**Acceptance Criteria:**
1. En viewports < 640px (mobile), la barra inferior reemplaza al drawer hamburguesa. La barra tiene 5 tabs: 🏠 Home (`/`), 🔍 Explorar (`/explore`), ➕ central FAB (`/publish`), 📊 Dashboard (condicional), 👤 Perfil.
2. El botón ➕ central es un FAB elevado (shadow, z-50) con color AVAX red `#E84142`, circular, mayor que los demás tabs.
3. Al hacer clic en ➕, navega a `/[locale]/publish`.
4. Tab activo: color AVAX red `#E84142`. Tab inactivo: gris (`text-gray-500`).
5. La barra respeta el safe area de iOS: `padding-bottom: env(safe-area-inset-bottom)`.
6. El header en mobile se simplifica: solo muestra el logo de WasiAI y el botón de wallet (WalletConnectButton). Los demás elementos del header actual desaparecen en mobile.
7. En desktop (≥ 640px), la navbar existente permanece sin cambios. La barra inferior NO aparece en desktop.
8. Tab Dashboard: si el usuario tiene rol creator (`creator_profiles` row exists) → navega a `/creator/dashboard`. Si es consumer → navega a `/dashboard` (saldo de API key). Si no está autenticado → navega a `/auth`.
9. Tab Perfil: navega a `/[locale]/profile`. Si no está autenticado → navega a `/auth`.
10. Traducciones en es/en para todos los labels de la barra.

**Scope (archivos a crear/modificar):**
- `src/components/MobileBottomNav.tsx` — nuevo componente client-side con los 5 tabs
- `src/components/WasiNavBar.tsx` — simplificar en mobile: header solo logo + wallet; ocultar menú hamburguesa
- `src/app/[locale]/layout.tsx` — incluir `<MobileBottomNav />` debajo del `<main>` (fuera del scroll)
- `src/messages/en.json` / `src/messages/es.json` — claves `mobileNav.*`
- `src/hooks/useIsCreator.ts` — hook para verificar si el usuario tiene perfil de creator (o reusar existente)

**Dependencias:** WAS-45 (WalletConnectButton ya existe desde Sprint 7 ✅)

**Estimación:** M

**Riesgos:**
- Safe area en PWA/Safari iOS requiere `viewport-fit=cover` en meta tag — verificar que ya existe en layout.tsx
- El FAB central puede solaparse con el contenido si hay elementos con position fixed — revisar z-index stack
- `useIsCreator` requiere query a Supabase — debe ser lazy/cached para no impactar performance de navegación
- Posible conflicto con el botón de cookies o modales que usan position fixed en la parte inferior

---

## Epic 9: UX Improvements

> Mejoras de conversión y retención en paralelo con épicas principales.

### Story 9.1: Empty state de búsqueda
Sugerencias de agentes populares cuando no hay resultados.

### Story 9.2: Preview live en publish
Creator ve exactamente cómo quedará su ficha antes de publicar.

### Story 9.3: Editor de capabilities sin JSON crudo
Campos estructurados en lugar de JSON manual.

### Story 9.4: Code examples auto-generados
Curl, Node.js, Python en la ficha del agente — basado en slug y precio.

### Story 9.5: Indicador de saldo de API key en navbar
El usuario ve cuánto USDC tiene disponible sin ir al dashboard.

### Story 9.6: Hero copy específico por usuario
Creator: "Publica tu agente, cobra en USDC" / Consumer: "Encuentra el agente que necesitas".

### Story 9.7: i18n — copias reales de WasiAI
Reemplazar copy del template NexusFactory con copy real en es/en.

---

## Sprint 7 — Wallet UX & Marketplace Polish ✅ DONE

> Sprint de calidad: corregir el bug crítico de pago, estandarizar wallet UX en navbar, y completar las mejoras de marketplace más solicitadas.
> **Estado:** COMPLETADO — QA aprobado 2026-02-27. 6/6 historias APROBADAS.

---

### WAS-46 — BUG: Botón Pay debe conectar wallet cuando no hay wallet conectada

**Historia de usuario:**
> Como usuario que quiere pagar por un agente, cuando hago clic en "Pay" sin tener una wallet conectada, quiero que el sistema me muestre el flujo de conexión de wallet automáticamente, para no perder el contexto de lo que estaba haciendo.

**Criticidad:** P0 — BUG bloqueante de conversión

**Acceptance Criteria:**
1. Cuando el usuario hace clic en "Pay" y `ctx.account` es undefined/null, el componente muestra el modal de selección de wallet (misma UI que WAS-45).
2. Después de conectar la wallet exitosamente, el flujo de pago continúa automáticamente desde donde se interrumpió (input preservado).
3. El botón "Pay" NO ejecuta `pay()` si no hay wallet conectada — en su lugar dispara `handleConnect()`.
4. El estado del input del usuario se preserva durante el flujo de conexión.
5. Si el usuario cierra el modal sin conectar, vuelve al estado inicial del botón (no error, no loading).
6. Test: usuario sin wallet → clic Pay → conecta wallet → pago procede sin acción extra del usuario.

**Scope (archivos a modificar):**
- `src/features/payments/components/PayToCallButton.tsx` — lógica principal del bug fix
- `src/features/payments/hooks/useWalletPayment.ts` — verificar que `ctx.account` es accesible

**Dependencias:** WAS-45 (reutiliza el hook/componente de connect de navbar)

**Estimación:** XS

**Riesgos:**
- Race condition entre connect y pay si wagmi no expone el account inmediatamente post-connect
- El modal de WAS-45 debe estar accesible como componente reutilizable

---

### WAS-45 — Wallet connect/disconnect en WasiNavBar (estándar dApp)

**Historia de usuario:**
> Como usuario de WasiAI, quiero ver mi wallet conectada en la navbar con opción de desconectar, siguiendo el estándar de dApp, para saber en todo momento mi estado de conexión sin ir a la ficha de un agente.

**Criticidad:** P1 — UX estándar Web3 que hoy no existe en navbar

**Acceptance Criteria:**
1. La navbar muestra un botón "Connect Wallet" cuando no hay wallet conectada.
2. Al hacer clic, se abre un modal con los connectors disponibles (misma lista que PayToCallButton, deduplicada, sin "Injected").
3. Cuando hay wallet conectada, el botón muestra la dirección truncada (0x1234...abcd) y un indicador visual de red.
4. Al hacer clic en la dirección truncada, aparece un dropdown con opción "Disconnect".
5. Al desconectar, el botón vuelve a mostrar "Connect Wallet".
6. El estado de wallet es compartido globalmente via wagmi (no estado local) — PayToCallButton lo detecta automáticamente.
7. En mobile (hamburger menu), el botón de wallet aparece como item del menú.
8. Si la wallet está en red incorrecta, mostrar indicador de red incorrecta (sin bloquear la navbar).

**Scope (archivos a modificar/crear):**
- `src/components/WasiNavBar.tsx` — agregar WalletButton
- `src/features/payments/components/WalletConnectButton.tsx` — nuevo componente reutilizable
- `src/features/payments/components/WalletConnectModal.tsx` — modal de connectors (extraer de PayToCallButton)
- `src/messages/en.json` / `src/messages/es.json` — claves i18n para wallet UI

**Dependencias:** Ninguna (wagmi ya está configurado)

**Estimación:** S

**Riesgos:**
- Conflicto de estado si PayToCallButton y WasiNavBar tienen modales independientes — debe haber una sola fuente de verdad
- SSR: wagmi hooks son client-only, requiere `'use client'` en WasiNavBar o componente hijo

---

### WAS-47 — Botón "Ver agentes" en Home hace scroll a sección de agentes

**Historia de usuario:**
> Como visitante de la home, cuando hago clic en el botón "Ver agentes" del hero, quiero que la página haga scroll suave hacia la sección de agentes del marketplace, para no tener que hacer scroll manual.

**Criticidad:** P3 — mejora de UX básica

**Acceptance Criteria:**
1. El botón "Ver agentes" (consumer CTA) en `HeroDualCard` hace scroll suave a la sección de agentes en la misma página.
2. El scroll usa `behavior: 'smooth'` nativo.
3. La sección de agentes tiene un `id` anchor (`id="agents"`) para ser objetivo del scroll.
4. En mobile el scroll funciona igual.
5. Si el usuario está en `/publish` u otra ruta, el botón navega a `/${locale}#agents` (no scroll en misma página).

**Scope (archivos a modificar):**
- `src/features/home/components/HeroDualCard.tsx` — cambiar Link a botón con scrollIntoView o href anchor
- `src/app/[locale]/page.tsx` — agregar `id="agents"` a la sección de grid de agentes

**Dependencias:** Ninguna

**Estimación:** XS

**Riesgos:** Ninguno significativo

---

### HU-9.1 — Empty state cuando búsqueda retorna 0 resultados

**Historia de usuario:**
> Como usuario buscando agentes, cuando mi búsqueda no encuentra resultados, quiero ver una pantalla amigable con sugerencias de agentes populares, para no quedarme con una página vacía y poder descubrir agentes relevantes.

**Acceptance Criteria:**
1. Cuando `models.length === 0` y hay un término de búsqueda activo (`search` param), se muestra un componente `EmptySearchState` en lugar del grid vacío.
2. El empty state muestra: icono, mensaje "No encontramos agentes para '{search}'", y sugerencia de limpiar filtros.
3. El empty state incluye hasta 4 agentes sugeridos (los más llamados / mejor valorados) cargados desde el mismo endpoint con `limit=4` sin filtros.
4. Hay un botón "Ver todos los agentes" que limpia la búsqueda y vuelve al marketplace completo.
5. Si la búsqueda tiene 0 resultados Y hay filtro de categoría activo, el mensaje sugiere también quitar el filtro de categoría.
6. El empty state tiene traducciones en es/en.

**Scope (archivos a crear/modificar):**
- `src/features/models/components/EmptySearchState.tsx` — nuevo componente
- `src/app/[locale]/page.tsx` — renderizar EmptySearchState cuando models.length === 0
- `src/messages/en.json` / `src/messages/es.json` — claves i18n

**Dependencias:** Ninguna (la API ya retorna 0 resultados, solo falta la UI)

**Estimación:** S

**Riesgos:** Los agentes sugeridos requieren una segunda llamada a `getModels` — evaluar si se puede hacer en el mismo server component o necesita fetch separado

---

### HU-9.2 — Preview live en /publish (creator ve la card en tiempo real)

**Historia de usuario:**
> Como creator publicando un agente, mientras lleno el formulario de publicación, quiero ver una preview en tiempo real de cómo quedará la card de mi agente en el marketplace, para asegurarme de que se ve profesional antes de publicar.

**Acceptance Criteria:**
1. En la página `/publish`, hay un panel lateral (desktop) o sección inferior (mobile) que muestra una `ModelCard` con los datos del formulario en tiempo real.
2. La preview se actualiza con cada keystroke (sin debounce visible, o debounce ≤ 200ms).
3. Los campos reflejados en la preview: nombre, descripción, precio, categoría, slug (para el badge), y una imagen placeholder si no hay imagen.
4. Si un campo requerido está vacío, la preview muestra un placeholder en gris (no error).
5. La preview está claramente etiquetada como "Preview" con un badge o label.
6. En mobile, la preview es collapsible (toggle "Ver preview" / "Ocultar preview").
7. La preview usa exactamente el mismo componente `ModelCard` que el marketplace — no un componente duplicado.

**Scope (archivos a crear/modificar):**
- `src/app/[locale]/publish/PublishForm.tsx` — agregar estado del formulario y pasar a preview
- `src/features/publish/components/PublishPreview.tsx` — nuevo wrapper de la preview
- `src/features/models/components/ModelCard.tsx` — verificar que acepta datos parciales sin crashear
- `src/messages/en.json` / `src/messages/es.json` — claves i18n para label "Preview"

**Dependencias:** Ninguna (ModelCard ya existe)

**Estimación:** M

**Riesgos:**
- PublishForm.tsx puede ser un Server Component — necesita convertirse a Client Component o extraer la lógica de preview a un componente hijo client-only
- ModelCard puede asumir datos completos y crashear con datos parciales — revisar tipos y agregar defaults

---

### HU-4.2 — Filtros avanzados en marketplace (tipo agente, precio max, categoría)

**Historia de usuario:**
> Como usuario explorando el marketplace, quiero poder filtrar agentes por tipo (LLM, RAG, tool, etc.), precio máximo y categoría combinados, para encontrar exactamente el agente que necesito sin revisar todo el catálogo.

**Acceptance Criteria:**
1. El marketplace muestra un panel/row de filtros con: selector de categoría (ya existe), selector de tipo de agente (`agent_type`), y slider o input de precio máximo (`max_price` en USDC).
2. Los filtros son acumulables — categoría + tipo + precio max funcionan juntos en la misma query.
3. La URL refleja los filtros activos como query params (`?category=X&agent_type=Y&max_price=Z`) — compatible con back/forward del browser.
4. Cuando hay filtros activos, hay un botón "Limpiar filtros" visible.
5. Los filtros disponibles para `agent_type` son: `llm`, `rag`, `tool`, `multimodal`, `code` — mostrados como chips o select.
6. El filtro de precio máximo acepta valores entre 0 y 10 USDC con pasos de 0.10.
7. Los filtros no causan full page reload — usan `router.push` con los params actualizados.
8. Los filtros tienen traducciones en es/en.
9. La API (`/api/v1/agents`) ya soporta estos params — esta HU es solo implementación UI.

**Scope (archivos a crear/modificar):**
- `src/features/models/components/FilterPanel.tsx` — nuevo componente con todos los filtros
- `src/features/models/components/CategoryFilter.tsx` — integrar dentro de FilterPanel o mantener standalone
- `src/app/[locale]/page.tsx` — leer nuevos searchParams y pasarlos a getModels
- `src/features/models/services/models.service.ts` — agregar `agent_type` y `max_price` a la función `getModels`
- `src/messages/en.json` / `src/messages/es.json` — claves i18n para labels de filtros

**Dependencias:** Ninguna (API ya lista con estos params)

**Estimación:** M

**Riesgos:**
- El slider de precio en SSR puede ser complejo — evaluar usar input number en lugar de slider para simplicidad
- Compatibilidad con CategoryFilter existente — evitar duplicar lógica de URL params
