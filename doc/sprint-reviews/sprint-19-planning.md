# Sprint Planning — Semana 2026-03-03

**SM:** San  
**Sprint:** 19 — Security Hardening  
**Próximo NNN disponible:** 034

---

### Sprint anterior (S18)

| HUs completadas | HUs en progreso | HUs abortadas |
|-----------------|-----------------|---------------|
| 5 | 0 | 0 |

> S18 cerró al 100% (11/11 SP). HUs: WAS-120, WAS-118, WAS-119, WAS-121, WAS-122. NNNs 029–033.

---

### Backlog priorizado

| Prioridad | HU | Tipo | Estimación | SDD_MODE |
|-----------|----|------|------------|----------|
| P1 | NA-002: Fix .gitignore (secrets expuestos) | FAST-FIX | S | FAST |
| P2 | NA-010: Rename NEXT_PUBLIC_ → WASIAI_OWNER_ADDRESS en verifyAdminSignature | FAST-FIX | S | FAST |
| P3 | NA-008 + NA-011: Fix test roto + onlyOperator refactor | FAST-FIX | S | FAST |
| P4 | NA-001: Fix ABI mismatch setPlatformFee → proposeFee/executeFee | FAST-FIX | M | FAST |
| P5 | NA-005: Auth INTERNAL_API_SECRET en 5 endpoints agents-internal | FAST-FIX | M | FAST |
| P6 | NA-004: Rate limiter fallback 503 cuando Upstash cae | HU-MINOR | M | QUALITY |
| P7 | NA-003: Safe multisig 2-de-3 + Ownable2Step + separar roles | HU-MINOR | L | QUALITY |
| P8 | NA-006: Vista creator_public_profiles (si hay tiempo) | HU-MINOR | S | QUALITY |

---

### Capacidad del sprint

- Sprint duration: 1 semana
- Velocidad referencia: 5 HUs / sprint (S18)
- Estimación S19: 5–7 HUs (los FAST-FIX son pequeños y rápidos; la L cuenta como el equivalente a 2–3)

---

### Selección propuesta

- [ ] NA-002: Fix .gitignore — FAST-FIX — S
- [ ] NA-010: Rename NEXT_PUBLIC_ → WASIAI_OWNER_ADDRESS — FAST-FIX — S
- [ ] NA-008 + NA-011: Fix test + onlyOperator refactor — FAST-FIX — S
- [ ] NA-001: Fix ABI mismatch setPlatformFee → proposeFee/executeFee — FAST-FIX — M
- [ ] NA-005: Auth INTERNAL_API_SECRET en 5 endpoints agents-internal — FAST-FIX — M
- [ ] NA-004: Rate limiter fallback 503 cuando Upstash cae — HU-MINOR — M
- [ ] NA-003: Safe multisig 2-de-3 + Ownable2Step + separar roles — HU-MINOR — L

> NA-006 (Vista creator_public_profiles) queda como stretch goal si hay tiempo tras cerrar NA-003.

**SPRINT_APPROVED — 2026-03-03 por Fer.**

Pipeline QUALITY inicia por HU en orden de prioridad: NA-002 → NA-010 → NA-008+NA-011 → NA-001 → NA-005 → NA-004 → NA-003.
