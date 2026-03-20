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
| 050 | 2026-03-14 | WAS-214 | Registro programático de agentes sin browser — POST /api/v1/auth/agent-signup | feature | QUALITY | DONE | b370c1d |
| 051 | 2026-03-14 | WAS-215 | Health check async al registrar agente — activación automática sin cron | feature | QUALITY | DONE | defb237 |
| 052 | 2026-03-14 | WAS-196 | sandbox_enabled expuesto en GET /agents y GET /agents/:slug | feature | QUALITY | DONE | 8a26b8b |
| 053 | 2026-03-14 | WAS-213 | performance_score basado en error_rate_7d + trigger 058 + filter min_reputation | feature | QUALITY | DONE | 93cd8d1 |
| 054 | 2026-03-14 | WAS-197 | AgentKit × WasiAI ejemplo funcional con x-agent-key | feature | HU-MAJOR | DONE | 77cc218 |
| 055 | 2026-03-14 | WAS-186 | Scope check en invoke directo + error code agent_not_in_scope | fix | QUALITY | DONE | 1adff02 |
| 056 | 2026-03-14 | WAS-200 | validateInput pre-cobro en POST /invoke — input inválido retorna 422 sin cobrar | fix | QUALITY | DONE | c1d5e55 |
| 057 | 2026-03-14 | F-03 | SECURITY_NOTE comment en probeEndpoint SERVICE_ROLE | fix | FAST-FIX | DONE | 4b0c789 |
| 058 | 2026-03-14 | WAS-199 | /reputation endpoint: performance_score + reputation_score + erc8004_score + format_compliance_pct | feature | HU-MAJOR | DONE | c0c113f |
| 059 | 2026-03-14 | WAS-191 | performance_score badge semafórico en perfil del agente UI | feature | HU-MINOR | DONE | 659251d |
| 060 | 2026-03-14 | WAS-187 | discoverAgent rankea por performance_score DESC + min_performance constraint | improvement | HU-MAJOR | DONE | de42329 |
| 061 | 2026-03-14 | F-02 | DNS rebinding en health-probe: node:https.request con SNI + fail-closed + IPv6 brackets | fix | QUALITY | DONE | 992a1dc |
| 062 | 2026-03-15 | S6-03 | Formalizar WAS-132: nonce en agent_calls + docs arquitectura pagos | improvement | FAST-FIX | DONE | d893455 |
| 063 | 2026-03-15 | S6-A3 | Exponer min_performance en GET /agents + NaN guard + fix min_reputation bug | feature | FAST-FIX | DONE | 15f82d0 |
| 064 | 2026-03-15 | S6-01 | Error recovery post-settlement: tabla settlement_failures + admin status | feature | HU-MAJOR | DONE | edb3461 |
| 065 | 2026-03-15 | S6-02 | Observabilidad x402: logs estructurados + x402_health en admin/status | feature | HU-MAJOR | DONE | b2defe6 |
| 066 | 2026-03-15 | S6-audit | Fix post-audit: RLS settlement_failures + auth admin/status + Supabase error check | fix | FAST-FIX | DONE | 45b9bdf |
| 062 | 2026-03-15 | S6-03 | Formalizar WAS-132: nonce en agent_calls + docs arquitectura pagos | improvement | FAST-FIX | DONE | d893455 |
| 063 | 2026-03-15 | S6-A3 | Exponer min_performance en GET /agents + NaN guard + fix min_reputation bug | feature | FAST-FIX | DONE | 15f82d0 |
| 064 | 2026-03-15 | S6-01 | Error recovery post-settlement: tabla settlement_failures + admin status | feature | HU-MAJOR | DONE | edb3461 |
| 065 | 2026-03-15 | S6-02 | Observabilidad x402: logs estructurados + x402_health en admin/status | feature | HU-MAJOR | DONE | b2defe6 |
| 066 | 2026-03-15 | S6-audit | Fix post-audit: RLS settlement_failures + auth admin/status + Supabase error check | fix | FAST-FIX | DONE | 45b9bdf |
| 067 | 2026-03-15 | S7-01 | avaxBalance BigInt fix — log errors + avaxBalanceError en admin/status | bugfix | FAST-FIX | DONE | d3fde150 |
| 068 | 2026-03-15 | S7-02 | min_performance filter aplicado en slim + search paths de GET /agents | bugfix | FAST-FIX | DONE | aa2528ae |
| 069 | 2026-03-15 | WAS-192 | Non-custodial messaging en landing, onboarding y PayToCallButton | improvement | FAST-FIX | DONE | 5a0c5771 |
| 070 | 2026-03-15 | S7-03 | Nonce x402 persistido en agent_calls + 402 payment_already_used en replay | improvement | HU-MINOR | DONE | 2189aa6f |
| 071 | 2026-03-15 | WAS-207 | POST /introspect — COB firmado + pricing por depth + auth dual | feature | HU-MAJOR | DONE | eeeddaa1 |
| 072 | 2026-03-15 | WAS-188 | Reputación ponderada — votes_weighted component + weightedPaidRatio | improvement | HU-MAJOR | DONE | e6033cf7 |
| 073 | 2026-03-15 | WAS-182 | improvement | FAST-FIX | DONE | 1b0638bb3 |
| 074 | 2026-03-15 | WAS-204 | bugfix | HU-MINOR | DONE | 865094ad6 |
| 075 | 2026-03-15 | WAS-189 | feature | HU-MAJOR | DONE | e299ab0d7 |
| 076 | 2026-03-15 | BUG-03 | bugfix | FAST-FIX | DONE | bf173c2d0 |
| 077 | 2026-03-15 | DEUDA-docs | bugfix | FAST-FIX | DONE | 868aee249 |
| 078 | 2026-03-19 | WAS-078 | improvement | QUALITY | DONE | 717011636 |
| 079 | 2026-03-20 | WAS-256 | improvement | FAST-FIX | DONE | c3204e7a0 |
| 080 | 2026-03-20 | WAS-258 | improvement | QUALITY | DONE | 4e0db2340 |
| — | — | WAS-257 | improvement | HU-MAJOR | DEFERRED | — |
