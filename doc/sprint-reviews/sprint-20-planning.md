# Sprint Planning — Sprint 20 — "Modelo Económico"

**SM:** San
**Fecha:** 2026-03-03
**Próximo NNN disponible:** 035

---

## Sprint anterior (S19)

| HUs completadas | HUs en progreso | HUs abortadas |
|-----------------|-----------------|---------------|
| 7 | 0 | 0 |

> S19 cerró al 100% — Security Hardening. 8/9 findings del audit cerrados. Push a master `07fb3cf`. 1 finding diferido (NA-003 Parte B — Safe multisig, condición de entrada Mainnet).

---

## Backlog priorizado — Bloque Económico

| Prioridad | HU | Tipo | Estimación | SDD_MODE |
|-----------|----|------|------------|----------|
| P1 | WAS-132: Eliminar `recordInvocation()` del hot path — registro off-chain | improvement | M | QUALITY |
| P2 | WAS-133: Gas fee dinámico x402 con Chainlink + banner WasiAI Key (sin umbral, aplica siempre) | feature | L | QUALITY |
| P2 | WAS-131: Freemium publish — primer agente gratis, listing fee en adicionales | feature | L | QUALITY |
| P2 | WAS-134: Facilitador x402 propio en mainnet (reemplazar UltravioletaDAO) | improvement | M | QUALITY |
| P2 | WAS-135: Docs transparencia — modelo de negocio y fees para usuarios | feature | S | FAST |

---

## Capacidad del sprint

- Sprint duration: 1 semana
- Velocidad referencia: S19 = 7 HUs (~2h) / S18 = 5 HUs QUALITY (~2h)
- Estimación S20: 4–5 HUs (2 L + 2 M + 1 S = sprint completo)
- Nota: las 2 HUs L (WAS-133 y WAS-131) son las más complejas del backlog económico

---

## Selección propuesta

- [ ] WAS-132: Eliminar `recordInvocation()` — improvement — M — **P0 rentabilidad**
- [ ] WAS-135: Docs transparencia — feature — S — acompaña el cambio económico
- [ ] WAS-134: Facilitador x402 propio en mainnet — improvement — M
- [ ] WAS-133: Gas fee dinámico x402 + banner WasiAI Key — feature — L — aplica siempre, sin umbral, lenguaje propio
- [ ] WAS-131: Freemium publish — feature — L — si hay capacidad

> WAS-132 va primero — es el mayor ahorro de gas (~$30/día eliminado) y el cambio más limpio.
> WAS-131 y WAS-133 son las más grandes — entran si la velocidad del sprint lo permite.

**SPRINT_APPROVED — 2026-03-03 por Fer.**

Pipeline QUALITY inicia por HU en orden: WAS-132 → WAS-135 → WAS-134 → WAS-133 → WAS-131.
