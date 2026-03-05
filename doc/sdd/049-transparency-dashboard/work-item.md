# Work Item #049 — WAS-162: Transparency Dashboard — On-chain Economics

> Fecha: 2026-03-05
> Tipo: feature
> SDD_MODE: full
> Branch: feat/049-transparency-dashboard

---

## Work Item

| Campo | Valor |
|-------|-------|
| **#** | 049 |
| **Linear** | WAS-162 |
| **Tipo** | feature |
| **SDD_MODE** | full |
| **Objetivo** | Mostrar estadísticas económicas on-chain del marketplace en la web: volumen total, invocaciones, comisión, agentes on-chain. Transparencia total como diferenciador vs marketplaces web2. |
| **Reglas de negocio** | Ver sección abajo |
| **Scope IN** | Stats compactos en footer (todas las páginas), página dedicada `/transparency` con breakdown detallado, lectura directa del contrato (read-only, sin gas) |
| **Scope OUT** | Gráficos históricos (requeriría indexer/subgraph), earnings individuales por creator (privacidad) |
| **Missing Inputs** | Ninguno — todos los datos disponibles vía funciones view del contrato |

---

## Reglas de Negocio

1. **Los datos se leen directamente del contrato** — no de Supabase. Es el punto: verificable on-chain.
2. **Footer stats** visibles en todas las páginas: volumen total, invocaciones totales, fee del marketplace (%).
3. **Página `/transparency`** con breakdown: stats globales + lista de agentes on-chain con precio individual.
4. **Sin gas** — son llamadas `view` (read-only), no cuestan nada.
5. **Refresh**: client-side, cada 60s o on-demand con botón refresh.
6. **Formateo**: volumen en USDC con 2 decimales, invocaciones con separador de miles.

---

## Datos disponibles del contrato

| Función | Retorno | Uso |
|---------|---------|-----|
| `totalVolume()` | `uint256` | Volumen total procesado (USDC atomics) |
| `totalInvocations()` | `uint256` | Número total de invocaciones |
| `platformFeeBps()` | `uint256` | Comisión del marketplace (basis points, e.g. 1000 = 10%) |
| `getAgent(slug)` | `(address, uint256, uint64)` | Creator, precio, erc8004Id por agente |

---

## Criterios de Aceptación (EARS)

| AC | Tipo | Criterio |
|----|------|----------|
| AC1 | Ubiquitous | El footer de todas las páginas muestra volumen total, invocaciones totales y fee del marketplace |
| AC2 | Event-driven | Cuando el usuario navega a `/transparency`, se muestra un dashboard con stats globales y lista de agentes on-chain con su precio |
| AC3 | Unwanted | Si la llamada al contrato falla, el footer muestra un placeholder ("—") sin romper la página |
| AC4 | Ubiquitous | Todos los datos se leen directamente del contrato (funciones view), no de Supabase |
| AC5 | Event-driven | Cuando el usuario hace click en "Refresh", los stats se actualizan inmediatamente |

---

## Estimación

| Componente | Size |
|------------|------|
| Footer stats component | S |
| `/transparency` page | M |
| Contract read hook (wagmi `useReadContract`) | S |
| **Total** | **M** |

---

> HU_APPROVED: yes (2026-03-05)
