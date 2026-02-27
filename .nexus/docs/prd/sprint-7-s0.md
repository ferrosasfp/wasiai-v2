# Sprint 7 — S0 HUs para HU_APPROVED
**Fecha:** 2026-02-27 | **Estado:** Pendiente HU_APPROVED de Fer

---

## HU-WAS-46 — BUG: Botón Pay debe conectar wallet

**Como** usuario sin wallet conectada en página de detalle de agente,
**quiero** que al hacer clic en el botón Pay se abra el modal de conexión de wallet,
**para** poder pagar sin tener que buscar dónde conectar mi wallet.

**ACs:**
- AC1: Clic en Pay sin wallet conectada → abre modal de selección de wallet (mismo flujo que WAS-45)
- AC2: Una vez conectada la wallet, el botón Pay retoma el flujo de pago normalmente
- AC3: Si wallet ya conectada, comportamiento actual sin cambios

**Riesgo:** Bajo — usa el mismo hook de connect que se implementa en WAS-45

---

## HU-WAS-45 — Wallet connect/disconnect en WasiNavBar

**Como** usuario de WasiAI,
**quiero** ver un botón de conectar/desconectar wallet en la navbar,
**para** gestionar mi wallet desde cualquier página como en cualquier dApp estándar.

**ACs:**
- AC1: Navbar muestra botón "Conectar Wallet" cuando no hay wallet conectada
- AC2: Navbar muestra dirección truncada (0x1234...abcd) + botón desconectar cuando hay wallet conectada
- AC3: Botón conectar → abre modal de selección de wallet (Core, MetaMask, etc — reutiliza HU-PAY-1)
- AC4: Botón desconectar → desconecta y vuelve a estado "Conectar Wallet"
- AC5: El botón actual en página de detalle del agente DESAPARECE (se elimina de ahí)
- AC6: Visible en desktop y mobile (drawer)

**Riesgo:** Medio — requiere integrar wagmi en WasiNavBar (actualmente es Server Component parcial)

---

## HU-WAS-47 — "Ver agentes" scroll a sección de agentes en Home

**Como** visitante en el Home de WasiAI en mobile,
**quiero** que al hacer clic en "Ver agentes" la página haga scroll hacia el listado de agentes,
**para** descubrir los agentes disponibles sin tener que deslizar manualmente.

**ACs:**
- AC1: Clic en "Ver agentes" → scroll suave hacia el grid de agentes
- AC2: Funciona en desktop y mobile
- AC3: Sin cambios de layout ni visual

**Riesgo:** Mínimo — anchor scroll puro

---

## HU-9.1 — Empty state de búsqueda sin resultados

**Como** usuario que busca un agente y no encuentra resultados,
**quiero** ver un mensaje claro con sugerencias,
**para** no quedarme con una pantalla en blanco sin saber qué hacer.

**ACs:**
- AC1: Cuando búsqueda retorna 0 resultados → muestra empty state con ícono + mensaje "No encontramos agentes para '[query]'"
- AC2: Empty state incluye CTA: "Limpiar búsqueda" que resetea el filtro
- AC3: Empty state diferente si hay filtros activos vs búsqueda vacía
- AC4: i18n: mensaje en EN y ES

**Riesgo:** Bajo — solo UI, no toca API

---

## HU-9.2 — Preview live en /publish

**Como** creator publicando un agente,
**quiero** ver en tiempo real cómo quedará la card de mi agente mientras lleno el formulario,
**para** asegurarme de que la presentación es correcta antes de publicar.

**ACs:**
- AC1: Panel de preview visible junto al formulario (layout 2 columnas en desktop)
- AC2: Preview se actualiza en tiempo real con nombre, descripción, precio, categoría, capabilities
- AC3: Preview usa el mismo componente `AgentCard` del marketplace (consistencia visual)
- AC4: En mobile el preview aparece debajo del formulario (colapsable)
- AC5: Sin cambios en la lógica de submit existente

**Riesgo:** Medio — requiere refactor del layout de /publish para 2 columnas

---

## HU-4.2 — Filtros avanzados en marketplace

**Como** developer buscando un agente en WasiAI,
**quiero** filtrar por tipo de agente, rango de precio y categoría simultáneamente,
**para** encontrar el agente correcto más rápido.

**ACs:**
- AC1: Filtros disponibles: categoría (ya existe), tipo de agente (llm/tool/chain), precio máximo (slider o input)
- AC2: Filtros combinables entre sí y con búsqueda por texto
- AC3: URL refleja filtros activos (query params) — compartible y navegable con back button
- AC4: Chip/badge por cada filtro activo con X para eliminar individualmente
- AC5: "Limpiar filtros" resetea todo
- AC6: i18n EN/ES
- AC7: Sin cambios en `/api/v1/agents` — ya soporta `category`, `agent_type`, `max_price`, `q`

**Riesgo:** Bajo en backend (API ya lista), medio en UI (estado de filtros + URL sync)

---

## Scope total sprint 7

| HU | Estimación | Prioridad |
|---|---|---|
| WAS-46 BUG Pay | XS | P0 |
| WAS-45 Wallet navbar | S | P1 |
| WAS-47 Scroll home | XS | P3 |
| HU-9.1 Empty state | S | P2 |
| HU-9.2 Preview live | M | P1 |
| HU-4.2 Filtros avanzados | M | P1 |

**Para activar el gate:** Fer debe responder HU_APPROVED (o indicar cambios).
