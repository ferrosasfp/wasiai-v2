# Sprint 7 — Planning Formal
## WasiAI · BMAD Method v6
**Semana:** 2026-02-27 → 2026-03-06  
**Tema:** Wallet UX & Marketplace Polish  
**Scrum Master:** Bob (BMAD)  
**Estado:** 🟡 PENDIENTE HU_APPROVED DE FER

---

## Resumen ejecutivo

Sprint orientado a calidad y conversión. Hay un bug P0 bloqueante (WAS-46) que impide que usuarios sin wallet puedan pagar — es la primera prioridad. El resto del sprint completa la UX de wallet en la navbar (estándar dApp), dos mejoras de descubrimiento en marketplace y dos mejoras de UX para creators y consumers.

**Carga total:** 2×XS + 2×S + 2×M = estimación razonable para una semana

**Dependencia crítica:** WAS-45 debe implementarse antes que WAS-46 (WAS-46 reutiliza el `WalletConnectModal` que WAS-45 extrae).

---

## Orden de implementación sugerido

```
1. WAS-45  (S)  → extrae WalletConnectModal, agrega wallet btn a navbar
2. WAS-46  (XS) → reutiliza WalletConnectModal, fix del bug P0
3. WAS-47  (XS) → scroll anchor en home, rápido e independiente
4. HU-9.1  (S)  → empty state de búsqueda
5. HU-4.2  (M)  → filtros avanzados marketplace
6. HU-9.2  (M)  → preview live en /publish
```

---

## Historias del Sprint 7

---

### 🔴 WAS-46 — BUG: Botón Pay conecta wallet cuando no hay wallet conectada
**Prioridad:** P0 · **Tamaño:** XS · **Épica:** Epic 9 (UX)  
**Depende de:** WAS-45

**Historia de usuario:**
> Como usuario que quiere pagar por un agente, cuando hago clic en "Pay" sin tener una wallet conectada, quiero que el sistema me muestre el flujo de conexión de wallet automáticamente, para no perder el contexto de lo que estaba haciendo.

**Contexto técnico:**
Hoy `PayToCallButton.tsx` tiene `handleConnect` que setea `showWalletModal=true`, pero el botón "Pay" principal ejecuta `pay()` directamente si `ctx.state === 'idle'`, independientemente de si hay wallet conectada. Resultado: el botón no hace nada visible si no hay wallet.

**Acceptance Criteria:**
1. Cuando el usuario hace clic en "Pay" y no hay wallet conectada (`ctx.account` es null/undefined), el botón muestra el modal de selección de wallet en lugar de ejecutar `pay()`.
2. Después de conectar la wallet exitosamente, el flujo de pago continúa automáticamente (input preservado).
3. El botón "Pay" NUNCA ejecuta `pay()` sin wallet conectada.
4. El estado del input del usuario se preserva durante el flujo de conexión.
5. Si el usuario cierra el modal sin conectar, vuelve al estado inicial del botón (no error, no loading).
6. Test manual: usuario sin wallet → clic Pay → conecta wallet → pago procede sin acción extra del usuario.

**Scope:**
- `src/features/payments/components/PayToCallButton.tsx` ← fix principal
- `src/features/payments/hooks/useWalletPayment.ts` ← verificar `ctx.account`

---

### 🟠 WAS-45 — Wallet connect/disconnect en WasiNavBar (estándar dApp)
**Prioridad:** P1 · **Tamaño:** S · **Épica:** Epic 9 (UX)  
**Depende de:** Nada

**Historia de usuario:**
> Como usuario de WasiAI, quiero ver mi wallet conectada en la navbar con opción de desconectar, siguiendo el estándar de dApp, para saber en todo momento mi estado de conexión sin ir a la ficha de un agente.

**Contexto técnico:**
Hoy el único lugar donde se puede conectar una wallet es el `PayToCallButton` en la ficha de un agente. La navbar no tiene ningún indicador de wallet. El botón de conexión y el modal deben extraerse como componentes reutilizables que WAS-46 también usará.

**Acceptance Criteria:**
1. La navbar muestra un botón "Connect Wallet" cuando no hay wallet conectada.
2. Al hacer clic, se abre un modal con los connectors disponibles (deduplicados, sin "Injected").
3. Cuando hay wallet conectada, el botón muestra la dirección truncada (0x1234...abcd) y un indicador visual.
4. Al hacer clic en la dirección truncada, aparece un dropdown con opción "Disconnect".
5. Al desconectar, el botón vuelve a mostrar "Connect Wallet".
6. El estado de wallet es compartido globalmente via wagmi — `PayToCallButton` lo detecta automáticamente.
7. En mobile, el botón de wallet aparece como item del menú hamburguesa.
8. Si la wallet está en red incorrecta, mostrar indicador visual (sin bloquear la navbar).

**Scope:**
- `src/components/WasiNavBar.tsx` — integrar WalletButton
- `src/features/payments/components/WalletConnectButton.tsx` — nuevo componente
- `src/features/payments/components/WalletConnectModal.tsx` — extraer de PayToCallButton
- `src/messages/en.json` / `src/messages/es.json` — claves i18n

**Riesgos:**
- SSR: wagmi hooks son client-only → requiere `'use client'` o componente hijo
- Un solo modal global vs. instancias múltiples (coordinar estado)

---

### 🟡 WAS-47 — Botón "Ver agentes" en Home hace scroll a sección de agentes
**Prioridad:** P3 · **Tamaño:** XS · **Épica:** Epic 9 (UX)  
**Depende de:** Nada

**Historia de usuario:**
> Como visitante de la home, cuando hago clic en el botón "Ver agentes" del hero, quiero que la página haga scroll suave hacia la sección de agentes del marketplace, para no tener que hacer scroll manual.

**Acceptance Criteria:**
1. El botón consumer CTA en `HeroDualCard` hace scroll suave a la sección de agentes en la misma página.
2. El scroll usa `behavior: 'smooth'` nativo.
3. La sección de agentes tiene `id="agents"` como anchor objetivo.
4. En mobile el scroll funciona igual.
5. Si el usuario está en otra ruta, el botón navega a `/${locale}#agents`.

**Scope:**
- `src/features/home/components/HeroDualCard.tsx` — cambiar Link a botón/anchor
- `src/app/[locale]/page.tsx` — agregar `id="agents"` a la sección del grid

---

### 🟡 HU-9.1 — Empty state cuando búsqueda retorna 0 resultados
**Prioridad:** P2 · **Tamaño:** S · **Épica:** Epic 9 (UX)  
**Depende de:** Nada

**Historia de usuario:**
> Como usuario buscando agentes, cuando mi búsqueda no encuentra resultados, quiero ver una pantalla amigable con sugerencias de agentes populares, para no quedarme con una página vacía y poder descubrir agentes relevantes.

**Acceptance Criteria:**
1. Cuando `models.length === 0` y hay búsqueda activa, se muestra `EmptySearchState` en lugar del grid vacío.
2. El empty state muestra: icono, mensaje `"No encontramos agentes para '{search}'"`, sugerencia de limpiar filtros.
3. Incluye hasta 4 agentes sugeridos (más populares) cargados desde el mismo endpoint sin filtros.
4. Hay un botón "Ver todos los agentes" que limpia la búsqueda.
5. Si hay filtro de categoría activo también, el mensaje sugiere quitarlo.
6. Traducciones en es/en.

**Scope:**
- `src/features/models/components/EmptySearchState.tsx` — nuevo componente
- `src/app/[locale]/page.tsx` — renderizar EmptySearchState condicionalmente
- `src/messages/en.json` / `src/messages/es.json`

**Riesgos:** Segunda llamada a `getModels` para agentes sugeridos — evaluar si hacerla en el mismo server component

---

### 🟡 HU-9.2 — Preview live en /publish (creator ve la card en tiempo real)
**Prioridad:** P2 · **Tamaño:** M · **Épica:** Epic 9 (UX)  
**Depende de:** Nada

**Historia de usuario:**
> Como creator publicando un agente, mientras lleno el formulario de publicación, quiero ver una preview en tiempo real de cómo quedará la card de mi agente en el marketplace, para asegurarme de que se ve profesional antes de publicar.

**Acceptance Criteria:**
1. En `/publish`, hay un panel lateral (desktop) o sección inferior (mobile) que muestra una `ModelCard` con los datos del formulario en tiempo real.
2. La preview se actualiza con cada keystroke (debounce ≤ 200ms).
3. Campos reflejados: nombre, descripción, precio, categoría, slug (para badge), imagen placeholder.
4. Campos vacíos muestran placeholder en gris (no error).
5. La preview está etiquetada claramente como "Preview".
6. En mobile, la preview es collapsible.
7. La preview usa el mismo componente `ModelCard` del marketplace — sin duplicación.

**Scope:**
- `src/app/[locale]/publish/PublishForm.tsx` — agregar estado y pasar datos a preview
- `src/features/publish/components/PublishPreview.tsx` — nuevo wrapper
- `src/features/models/components/ModelCard.tsx` — verificar datos parciales sin crash
- `src/messages/en.json` / `src/messages/es.json`

**Riesgos:**
- PublishForm puede ser Server Component → necesita conversión a Client Component o split
- ModelCard puede asumir datos completos → revisar tipos y agregar defaults defensivos

---

### 🟡 HU-4.2 — Filtros avanzados en marketplace (tipo agente, precio max, categoría)
**Prioridad:** P2 · **Tamaño:** M · **Épica:** Epic 4 (Discovery)  
**Depende de:** Nada (API ya lista)

**Historia de usuario:**
> Como usuario explorando el marketplace, quiero poder filtrar agentes por tipo (LLM, RAG, tool, etc.), precio máximo y categoría combinados, para encontrar exactamente el agente que necesito sin revisar todo el catálogo.

**Contexto técnico:** La API `/api/v1/agents` ya acepta `category`, `agent_type`, `max_price`, `q`. Esta HU es **solo implementación UI** — no requiere cambios en backend.

**Acceptance Criteria:**
1. El marketplace muestra filtros de: categoría (ya existe), tipo de agente (`agent_type`), precio máximo (`max_price` en USDC).
2. Los filtros son acumulables — funcionan juntos en la misma query.
3. La URL refleja los filtros activos como query params (`?category=X&agent_type=Y&max_price=Z`).
4. Cuando hay filtros activos, hay botón "Limpiar filtros".
5. Tipos de agente disponibles: `llm`, `rag`, `tool`, `multimodal`, `code` — como chips o select.
6. Precio máximo: input/slider de 0 a 10 USDC con pasos de 0.10.
7. Los filtros no causan full page reload — usan `router.push` con params actualizados.
8. Traducciones en es/en.
9. API ya soporta estos params — solo UI.

**Scope:**
- `src/features/models/components/FilterPanel.tsx` — nuevo componente central de filtros
- `src/features/models/components/CategoryFilter.tsx` — integrar en FilterPanel
- `src/app/[locale]/page.tsx` — leer nuevos searchParams, pasar a getModels
- `src/features/models/services/models.service.ts` — agregar `agent_type` y `max_price` a getModels
- `src/messages/en.json` / `src/messages/es.json`

**Riesgos:**
- Slider de precio en SSR puede ser complejo → evaluar input number para simplicidad
- Compatibilidad con CategoryFilter existente → evitar duplicar lógica URL params

---

## Criterios de éxito del Sprint 7

| Historia | Criterio de éxito verificable |
|----------|-------------------------------|
| WAS-46 | Usuario sin wallet hace clic en Pay → conecta wallet → pago procede automáticamente |
| WAS-45 | Wallet visible en navbar en todas las páginas, estado compartido globalmente |
| WAS-47 | CTA del hero lleva al usuario a la sección de agentes con scroll suave |
| HU-9.1 | 0 resultados de búsqueda → empty state con sugerencias, no pantalla vacía |
| HU-9.2 | Creator ve preview de su card mientras llena el formulario |
| HU-4.2 | Usuarios filtran por tipo de agente + precio máximo combinados |

---

## Definition of Done global (sprint 7)

- [ ] 0 errores TypeScript en `npm run build`
- [ ] 0 warnings ESLint
- [ ] Adversarial review completado antes de cada commit
- [ ] Traducciones en `en.json` / `es.json` para toda nueva UI visible
- [ ] `git push origin master master:main`

---

## Próximos pasos

1. **Fer lee este documento** y da **HU_APPROVED** para las 6 historias (o ajusta scope)
2. Con HU_APPROVED → Bob genera los story files individuales (`story-WAS-45.md`, etc.)
3. Con story files → S1 (SDD + Implementation Readiness Check) → SPEC_APPROVED de Fer
4. Con SPEC_APPROVED → Dev implementa desde el story file

---

*Generado por Bob (BMAD Scrum Master) · 2026-02-27*  
*Metodología: BMAD Method v6 · WasiAI Sprint 7*
