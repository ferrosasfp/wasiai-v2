# SDD Index — WasiAI v2

| # | Fecha | ID | Título | Tipo | Mode | Status | Branch |
|---|-------|----|--------|------|------|--------|--------|
| 001 | 2026-02-27 | WAS-63 | Navbar desktop: saldo USDC invisible | bugfix | bugfix | DONE | fix/001-navbar-usdc-invisible |
| 002 | 2026-02-27 | WAS-64 | Analytics completamente vacío (web y mobile) | bugfix | bugfix | DONE | fix/002-analytics-vacio |
| 003 | 2026-02-28 | WAS-08 | UX-08: Validación backend Zod en /api/models | improvement | fast | DONE | feat/003-ux08-validacion-backend |
| 004 | 2026-03-01 | WAS-42 | HU-7.3: AgentKit Example (Coinbase) | feature | full | DONE | feat/004-agentkit-example |
| 005 | 2026-02-28 | WAS-44 | HU-8.4: Rate Limiting configurable por creator | feature | full | DONE | feat/005-rate-limiting-creator |
| 006 | 2026-02-28 | WAS-45 | WAS-45: Wallet connect/disconnect en navbar | improvement | full | CANCELLED | — |
| 007 | 2026-02-28 | WAS-47 | WAS-47: Botón "Ver agentes" scroll | improvement | mini | CANCELLED | — |
| 008 | 2026-02-28 | WAS-48 | WAS-48: Bottom navigation mobile completa | feature | full | CANCELLED | — |
| 009 | 2026-03-01 | WAS-20 | HU-5.2: Ejecución paralela de agentes en compose | feature | full | DONE | feat/009-parallel-compose |
| 010 | 2026-03-01 | WAS-23 | HU-7.1: Plugin LangChain — WasiAI como Tool nativa | feature | full | DONE | feat/010-langchain-plugin |
| 011 | 2026-03-01 | WAS-68 | Sentry error tracking en WasiAI | feature | full | DONE | feat/011-sentry |
| 012 | 2026-03-01 | WAS-docs | Documentación WasiAI — rewrite completo | improvement | full | DONE | docs/012-docs-rewrite |
| 013 | 2026-03-02 | WAS-73 | Circuit breaker y retry automático en invocaciones | feature | QUALITY | DONE | master |
| 014 | 2026-03-02 | WAS-74 | Webhooks y eventos para agentes — UI + triggers + retry cron | feature | QUALITY | DONE | master |
| 015 | 2026-03-02 | WAS-115 | Paginación en Recent Calls del Creator Dashboard | improvement | QUALITY | DONE | master |
| 016 | 2026-03-02 | WAS-116 | Capabilities estructuradas en agentes DeFi Risk | feature | FAST | DONE | master |
| 017 | 2026-03-02 | WAS-117 | FIX CodeBlock docs código invisible | bugfix | FAST | DONE | master |
| 018 | 2026-03-02 | WAS-74-deuda | Deuda técnica Webhooks UI — 6 menores Sprint 14 | deuda | FAST | DONE | master |
| 019 | 2026-03-02 | WAS-70 | HU-5.1b — Ejecución asíncrona de pipelines (jobs + polling) | feature | QUALITY | DONE | master |
| 020 | 2026-03-02 | WAS-75 | HU-9.1 — Sandbox gratuito para builders (Fuji + créditos) | feature | QUALITY | DONE | master |
| 021 | 2026-03-02 | WAS-38 | HU-5.4 — UI visual de pipelines de agentes | feature | QUALITY | DONE | master |
| 022 | 2026-03-02 | WAS-71 | HU-6.5 — Agentes con wallet propia (self-custody payments) | feature | QUALITY | DONE | master |
| 023 | 2026-03-02 | WAS-89 | Tests MockUSDC firma ERC-3009 (ya implementado — cerrado sin pipeline) | tech-task | QUALITY | DONE | master |
| 024 | 2026-03-02 | WAS-103 | Arquitectura dual-flow OZ-A1 — FLOW GUIDE + whenNotPaused | refactor | QUALITY | DONE | master |
| 025 | 2026-03-02 | WAS-82 | Upkeep Listener — Vercel Cron Chainlink + runSettlement compartido | feature | QUALITY | DONE | master |
| 026 | 2026-03-02 | WAS-13 | CLI `wasiai invoke` — terminal client para agentes WasiAI | feature | QUALITY | DONE | master |
| 027 | 2026-03-02 | WAS-72 | WasiEscrow — escrow on-chain para invocaciones long-running (ERC-3009) | feature | QUALITY | DONE | master |
| 028 | 2026-03-02 | WAS-41 | LlamaIndex Plugin — `llama-index-wasiai` npm package (WasiAITool) | package | QUALITY | DONE | master |
| 029 | 2026-03-03 | WAS-120 | Playwright CI — e2e tests en GitHub Actions (navigation + language-switcher) | ci | QUALITY | DONE | master |
| 030 | 2026-03-03 | WAS-118 | refundExpired() trustless en WasiEscrow — payer retira tras 24h sin operador | feature | QUALITY | DONE | master |
| 031 | 2026-03-03 | WAS-119 | Pre-deploy checklist + env validation script (validate-env.js) | ops | QUALITY | DONE | master |
| 032 | 2026-03-03 | WAS-121 | Fix íconos cards Home — onError fallback emoji en ModelCard | bugfix | FAST | DONE | master |
| 033 | 2026-03-03 | WAS-122 | `_callEscrow()` helper + `estimated_completion` dinámico en invoke-long | refactor | FAST | DONE | master |
| 034 | 2026-03-03 | WAS-134 | Rate limiter fail-closed — 503 + Retry-After:60 cuando Upstash no disponible | improvement | QUALITY | DONE | master |
