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
| 035 | 2026-03-03 | WAS-132 | Eliminar recordInvocation() del hot path — Supabase como fuente de verdad | improvement | QUALITY | DONE | master |
| 036 | 2026-03-03 | WAS-134 | Facilitador x402 propio en mainnet — elimina dependencia UltravioletaDAO | improvement | QUALITY | DONE | master |
| 037 | 2026-03-03 | WAS-133 | Gas fee dinámico Chainlink + banner WasiAI Key en detail page | feature | QUALITY | DONE | master |
| 038 | 2026-03-03 | WAS-131 | Freemium publish — primer agente gratis, listing fee x402 real para siguientes | feature | QUALITY | DONE | master |
| 039 | 2026-03-04 | WAS-136 | Fix flash wrong_network en Core Wallet — chainSettled guard en useChainGuard | hotfix | hotfix | DONE | master |
| 039b | 2026-03-04 | WAS-138 | Fix 10 tests — mocks desactualizados tras HU-3.3 (use_trial RPC, runSettlement) | hotfix | hotfix | DONE | master |
| 040 | 2026-03-04 | WAS-137 | Edit agent — cover_image, capabilities, free_trial, max_rpm/rpd | improvement | QUALITY | DONE | master |
| 041 | 2026-03-04 | WAS-139 | Perfiles públicos — excluir /creator/[username] del auth guard en middleware | hotfix | hotfix | DONE | master |
| 042 | 2026-03-04 | WAS-140 | Pagos autónomos agente→agente — agentPay.ts + invoke-agent route | feature | QUALITY | DONE | master |
| 043 | 2026-03-04 | WAS-141 | Retiro parcial/total Agent Key — withdrawKey contrato + UI + backend sync | feature | QUALITY | DONE | master |
| 044 | 2026-03-05 | WAS-153 | Curated Collections — tables, pages, featured landing, navbar | feature | QUALITY | DONE | master |
| 045 | 2026-03-05 | WAS-154 | Creator CLI — wasiai discover + publish + stats | feature | QUALITY | DONE | master |
| 046 | 2026-03-05 | WAS-157 | Admin Collections CRUD — API + UI + agent manager | feature | QUALITY | DONE | master |
| 047 | 2026-03-05 | WAS-160 | EPIC: Dual Registration Off-chain + On-chain (ERC-8004) con Upgrade Path | EPIC | QUALITY | DONE | master |
| 048 | 2026-03-05 | WAS-161 | Sync precio on-chain al editar agente (creator paga gas, active removido) | feature | QUALITY | DONE | master |
| 049 | 2026-03-05 | WAS-162 | Transparency Dashboard — on-chain economics en footer + /transparency | feature | QUALITY | DONE | master |
| 050 | 2026-03-07 | HU-050 | Agent Keys — Migrar wallet a sistema unificado thirdweb | improvement | QUALITY | DONE | feat/050-agent-keys-unified-wallet |
| 051 | 2026-03-07 | HU-051 | Fix x402 operator EOA — payTo, settlePayment, isThirdweb detection | hotfix | PATCH | DONE | main |
| 052 | 2026-03-07 | HU-052 | Dual payment routes — Route B (EIP-3009 EOA) + Route C (embedded approve) | feature | BUGFIX | DONE | main |
| 053 | 2026-03-07 | HU-053 | Fix payViaApproval post-approve call en PayToCallButton | hotfix | PATCH | DONE | main |
| 054 | 2026-03-07 | HU-054 | withdrawKey revert — usar refundKeyToEarnings + withdrawFor via operador | hotfix | BUGFIX | DONE | main |
| 055 | 2026-03-07 | HU-055 | getKeyOwnerOnChain fallback — creator_profiles.wallet_address null bug | hotfix | PATCH | DONE | main |
| 056 | 2026-03-07 | HU-056 | Retiro completo via operador — refundKeyToEarnings + withdrawFor + DB sync | feature | QUALITY | DONE | main |
| 057 | 2026-03-07 | HU-057 | receipt.status check en withdrawFor y refundKeyToEarnings — HAL-025 | hotfix | PATCH | DONE | main |
| 058 | 2026-03-07 | HU-058 | owner_wallet_address en agent_keys — primer depositor lock + warning UI | feature | QUALITY | DONE | main |
| 059 | 2026-03-07 | HU-059 | Bloquear withdraw/close key para wallets no-owner — UI pill + API 403 | hotfix | PATCH | DONE | main |
| 060 | 2026-03-07 | HU-060 | Ocultar botones de acción sin wallet conectada | hotfix | PATCH | DONE | main |
| 061 | 2026-03-07 | HU-061 | Bloquear Route C — embedded wallets no pueden fondear Agent Keys | security | PATCH | DONE | main |
| 062 | 2026-03-07 | HU-062 | Fix typo USDC mainnet address — trailing E en 10 archivos | hotfix | PATCH | DONE | main |
| 064 | 2026-03-08 | HU-064 | Withdraw earnings directo desde wallet del creator | improvement | QUALITY | PENDING | feat/064-withdraw-earnings-direct |
