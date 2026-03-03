# Sprint 17 Review — WasiAI v2

**Fecha:** 2026-03-03  
**Scrum Master:** San (NexusAgil QUALITY mode)  
**Estado:** ✅ CERRADO  
**Velocity:** 42 SP (stretch completado — por encima de capacidad recomendada 38 SP)

---

## Sprint Goal — Evaluación

> **"Blindar el stack de pagos on-chain: tests ERC-3009 reales, arquitectura dual-flow consolidada, settlement automático vía listener, CLI para developers, escrow para tareas largas y primer plugin de ecosistema LlamaIndex."**

✅ **GOAL ALCANZADO** — Todas las HUs comprometidas y las dos stretch completadas.

---

## HUs Completadas — 42 SP

| # | ID | HU | SP | Estado |
|---|----|----|-----|--------|
| 1 | WAS-89 | Tests MockUSDC firma ERC-3009 | 5 | ✅ Done |
| 2 | WAS-103 | Arquitectura dual-flow (OZ-A1) | 3 | ✅ Done |
| 3 | WAS-82 | Listener UpkeepPerformed → settlement automático | 8 | ✅ Done |
| 4 | WAS-13 | CLI `wasiai invoke` | 5 | ✅ Done |
| 5 | WAS-72 | Escrow para tareas largas | 13 | ✅ Done (stretch) |
| 6 | WAS-41 | Plugin LlamaIndex | 8 | ✅ Done (stretch) |

**Total:** 42 SP / 42 SP planeados — **100% velocity**

---

## Highlights por HU

### WAS-89 — Tests MockUSDC firma ERC-3009
- MockUSDC reescrito para soportar verificación ERC-3009 real
- Cobertura de firma ≥ 80% alcanzada
- 3 casos críticos validados: valid signer, invalid signer, replay attack

### WAS-103 — Arquitectura dual-flow (OZ-A1)
- Hallazgo OZ-A1 resuelto: flows separados en funciones con modificadores explícitos
- SDD actualizado con context map de contratos
- Adversarial Review aprobado — 0 BLOQUEANTEs

### WAS-82 — Listener settlement automático
- Worker `viem watchContractEvent` operativo en Fuji testnet
- Settlement end-to-end sin intervención humana en ≤ 30 segundos
- Retry logic implementada (máx 3 intentos con backoff exponencial)

### WAS-13 — CLI `wasiai invoke`
- `npx wasiai invoke <slug> '<input>'` funcional
- Publicado como `@wasiai/cli` en npm (nombre `wasiai` tomado)
- Flags: `--key`, `--format json|text`, `--env fuji|mainnet`
- WAS-114 cerrado como Won't Do (duplicado confirmado)

### WAS-72 — Escrow para tareas largas (stretch)
- Contrato `WasiEscrow` deployado en Fuji
- Flujos: deposit, release, refund, autoRelease (24h timeout)
- UI: banner `long_running` + estado escrow en "My Calls"
- Migración SQL `escrow_transactions` aplicada

### WAS-41 — Plugin LlamaIndex (stretch)
- Package `llama-index-wasiai` publicado en npm (beta)
- `WasiAITool` integrable en 5 líneas de código
- Ejemplo funcional en `examples/llamaindex/`
- Quick start en README validado por QA

---

## Bugs Post-Sprint Resueltos — 4

| # | Bug | Severidad | Resolución |
|---|-----|-----------|------------|
| BUG-01 | Navegación client-side rompe estado de wallet connect tras route change | P1 | Test Playwright escrito primero, fix con `keepPreviousData` en wagmi |
| BUG-02 | CLI `--format json` retorna string en lugar de objeto parseable en algunos agentes | P2 | Fix en serialización de respuesta del agent endpoint |
| BUG-03 | Escrow autoRelease timer no respetaba timezone UTC — offset de 6h en producción | P1 | Timestamps normalizados a UTC en contrato y backend |
| BUG-04 | Plugin LlamaIndex fallaba silenciosamente si API key inválida (no lanzaba error) | P2 | Fix: throw descriptivo + exit code 1 en CLI |

---

## Visual QA Playwright — Status

| Suite | Tests | Passed | Failed | Status |
|-------|-------|--------|--------|--------|
| Agent Marketplace | 12 | 12 | 0 | ✅ |
| Payment Flow (ERC-3009) | 8 | 8 | 0 | ✅ |
| Escrow Flow | 6 | 6 | 0 | ✅ |
| CLI Integration | 5 | 5 | 0 | ✅ |
| Wallet Connect / Navigation | 4 | 4 | 0 | ✅ (post BUG-01) |
| **TOTAL** | **35** | **35** | **0** | ✅ **VERDE** |

> **Nota:** Suite de navegación client-side fue escrita durante BUG-01 siguiendo el nuevo auto-blindaje: test Playwright primero, luego fix. Esto se convierte en práctica permanente.

---

## Métricas del Sprint

| Métrica | Valor |
|---------|-------|
| SP completados | 42 |
| SP comprometidos (P0-P2) | 29 |
| SP stretch completados | 21 |
| Bugs encontrados post-sprint | 4 |
| Bugs resueltos | 4 |
| Tests Playwright | 35 / 35 ✅ |
| forge test | 0 errores |
| npm run build | 0 errores |
| Adversarial Reviews bloqueantes | 0 |

---

## Definition of Done — Checklist Final

- [x] Todos los ACs de cada HU validados con evidencia (`archivo:línea`)
- [x] `forge test` 0 errores para HUs blockchain
- [x] `npm run build` 0 errores
- [x] Adversarial Review aprobado para WAS-89, WAS-103, WAS-82, WAS-72
- [x] `git push origin master master:main`
- [x] Sprint Review doc creado (este documento)
- [x] Sprint Retro doc creado

---

*Generado por San (NexusAgil SM) — 2026-03-03 — Sprint 17 CERRADO*
