# Sprint Planning — Sprint 9
**Fecha:** 2026-02-27
**SM:** NexusAgil (San)
**Duración:** 1 semana (2026-02-27 → 2026-03-05)

---

## Sprint anterior (Sprint 8) — Resumen
> Sprint 8 no tiene artefactos registrados en `.nexus/docs/`. Se asume carry-over desde Sprint 7.

| HUs completadas | HUs en progreso | HUs abortadas |
|-----------------|-----------------|---------------|
| — | — | — |

---

## Objetivo del Sprint 9

> Estabilizar la experiencia core del producto: arreglar visualización de datos financieros (USDC), restablecer analytics, y corregir UX navigation bugs en mobile y web. Sprint de calidad antes de retomar features.

---

## Backlog priorizado (candidatos)

| Prioridad | ID | Título | Tipo | Estimación | SDD_MODE |
|-----------|-----|--------|------|-----------|----------|
| P1 | WAS-63 | Navbar desktop elementos borrosos (saldo USDC no visible) | bugfix | S | bugfix |
| P1 | WAS-64 | Analytics completamente vacío en web y mobile | bugfix | M | bugfix |
| P2 | WAS-65 | Mobile tab Home resaltado cuando se está en Explorar | bugfix | S | patch |
| P2 | WAS-66 | Categorías duplicadas en filtros marketplace | bugfix | S | patch |
| P2 | WAS-67 | Contenido cortado por bottom nav (falta padding) | bugfix | S | patch |
| P3 | HU-3.2 | Playground comparativo de agentes | feature | L | full |
| P3 | WAS-51 | Tether USDT multi-token support | feature | L | full |
| P3 | WAS-52 | Chainlink Price Feeds | feature | L | full |

---

## Selección Sprint 9

> Criterio: P1 primero, luego P2. Features grandes (HU-3.2, WAS-51, WAS-52) → diferidas a Sprint 10. Sprint enfocado en estabilidad.

| # | ID | Título | Tipo | Estimación | SDD_MODE | Pipeline |
|---|-----|--------|------|-----------|----------|---------|
| 1 | **WAS-63** | Navbar desktop elementos borrosos (saldo USDC no visible) | bugfix | S | bugfix | Full (bug crítico financiero) |
| 2 | **WAS-64** | Analytics completamente vacío en web y mobile | bugfix | M | bugfix | Full |
| 3 | **WAS-65** | Mobile tab Home resaltado cuando se está en Explorar | bugfix | S | patch | Quick Flow |
| 4 | **WAS-66** | Categorías duplicadas en filtros marketplace | bugfix | S | patch | Quick Flow |
| 5 | **WAS-67** | Contenido cortado por bottom nav (falta padding) | bugfix | S | patch | Quick Flow |

**Total seleccionado:** 5 ítems (2 P1 + 3 P2)

---

## Capacidad del sprint

- **Duración:** 7 días
- **Bugs S (Quick Flow):** 3 × S = estimación baja, 3 sesiones cortas
- **Bugs M (Full pipeline):** 1 × M = 1-2 sesiones medianas
- **Bugs S (Full pipeline):** 1 × S = 1 sesión corta
- **Capacidad total estimada:** 5-6 sesiones de trabajo — **viable**

### Diferidos a Sprint 10
| ID | Razón |
|----|-------|
| HU-3.2 | Feature L — requiere F0 completo, codebase grounding extenso. Sprint 9 es de estabilidad. |
| WAS-51 | Feature L multi-token — riesgo alto. Necesita sprint limpio. |
| WAS-52 | Feature L Chainlink — dependencia de infra. Diferido intencionalmente. |

---

## Criterios de éxito Sprint 9

- **WAS-63:** Saldo USDC visible y nítido en navbar desktop en todos los breakpoints
- **WAS-64:** Analytics muestra datos reales (o estado vacío con mensaje) en web y mobile; no pantalla en blanco
- **WAS-65:** Tab Home en mobile NO aparece resaltado cuando el usuario está en la vista Explorar
- **WAS-66:** Cada categoría aparece una sola vez en los filtros del marketplace
- **WAS-67:** El contenido de páginas con bottom nav tiene padding suficiente; nada queda cortado

---

## Orden de ejecución sugerido

```
Semana:
  Lun-Mar → WAS-63 (P1, S) + WAS-65 (P2, Quick Flow)
  Mar-Mie → WAS-64 (P1, M) — más tiempo por ser M
  Jue     → WAS-66 + WAS-67 (P2, Quick Flow ambos)
  Vie     → Buffer + Retrospectiva Sprint 9
```

---

## Notas del SM

1. **WAS-63 y WAS-64 son P1 financiero/datos** — arrancar ahí. Un saldo USDC invisible es un bloqueante de confianza del usuario.
2. **WAS-64 (Analytics vacío)** — antes de codear, verificar si es un problema de configuración (PostHog/Mixpanel key, env vars en Vercel) vs lógica. Puede ser Quick Win si es env var.
3. **WAS-65/66/67** son correcciones de UI triviales — candidatos para Quick Flow, no inflar con pipeline completo.
4. **Sprint 10 preview:** HU-3.2 (Playground comparativo) sería el feature estrella. Preparar F0 discovery al final de esta semana.
5. **Auto-Blindaje:** Cualquier error durante implementación se documenta en el momento en el `report.md` de cada HU.

---

*Generado por SM NexusAgil — 2026-02-27*
