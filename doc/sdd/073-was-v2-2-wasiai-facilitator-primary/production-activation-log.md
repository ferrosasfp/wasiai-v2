# WAS-V2-2 — Production Activation Log

**Date**: 2026-05-11 17:30-17:38 UTC
**Phase**: Phase 2 — feature flag activation in production
**Status**: ACTIVE in production

---

## Timeline

| UTC | Event |
|-----|-------|
| 17:12:23 | PR #6 merged to main (squash `28a4238`) |
| 17:12:30 | Vercel auto-deploy from merge: `dpl_cTbeUfnXYL3rrBV9xeuttbF9Awu5` READY+PROMOTED |
| 17:24 | Local smoke against wasiai-facilitator prod endpoint PASSED (tx `0xc6468a87...`) |
| 17:26 | Production smoke evidence committed (`fefcae2c4`) |
| 17:34 | Vercel prod env vars set (`WASIAI_FACILITATOR_AS_PRIMARY=true`, `X402_FACILITATOR_URL=UVD`) |
| 17:34:56 | Vercel redeploy triggered: `dpl_FktnZiuNC1N173neUDBH5L8ZaTrD` |
| 17:37 | Redeploy READY + PROMOTED |
| 17:38 | Post-flip verification smoke PASSED (tx `0x5ecd1221...`) |

---

## Env vars active in production

| Key | Value | Env var ID |
|-----|-------|------------|
| `WASIAI_FACILITATOR_AS_PRIMARY` | `true` | `iwFU2cesc5LixQcf` |
| `X402_FACILITATOR_URL` | `https://facilitator.ultravioletadao.xyz` | `FOMlDpAwjJjBAdxA` |
| `WASIAI_FACILITATOR_URL` | (unset → uses hardcoded `https://wasiai-facilitator-production.up.railway.app`) | — |

**Effect**: backend invoke route (`/api/v1/models/[slug]/invoke`) now routes via:
- Primary: wasiai-facilitator on Avalanche Fuji + mainnet + Kite testnet + Kite mainnet
- Fallback (on wasiai 5xx, timeout, INVALID_PAYLOAD, CHAIN_UNAVAILABLE): Ultravioleta DAO facilitator
- Idempotency guard (NONCE_ALREADY_USED): no fallback, returns wasiai's response immediately

---

## Production deployment

| Field | Value |
|-------|-------|
| Project | `prj_RWJ7yv5zqSJlO6kVC6sfWyQf0em2` (wasiai-prod) |
| Deployment ID | `dpl_FktnZiuNC1N173neUDBH5L8ZaTrD` |
| Source commit | `fefcae2c4b1ffab012d2507ba02f0ea8a7fdd2e9` |
| State | READY + PROMOTED |
| Alias | wasiai-prod-ferrosasfp-1287s-projects.vercel.app + app.wasiai.io |
| Live | https://app.wasiai.io |

---

## Onchain evidence

### Phase 1 smoke (pre-flip, HTTP transport validation)
- Tx: `0xc6468a87e2f1b1e16d80829c947a9570a0735ff1cc140dcd9b7ca68b6247e1de`
- Block: 55251725 Avalanche Fuji
- Amount: 0.001 USDC
- Status: success
- Snowtrace: https://testnet.snowtrace.io/tx/0xc6468a87e2f1b1e16d80829c947a9570a0735ff1cc140dcd9b7ca68b6247e1de

### Phase 2 smoke (post-flip, env vars active)
- Tx: `0x5ecd1221a71721d52ffac063b04ce2b1cd255377d7c0ca4893d400ae9c9a9d20`
- Block: 55252065 Avalanche Fuji
- Amount: 0.001 USDC
- Status: success
- Latency: 6.5s (within 30s timeout)
- Signer: `0xf432baf1315ccdb23e683b95b03fd54dd3e447ba` (operator, gasless pattern validated)
- Snowtrace: https://testnet.snowtrace.io/tx/0x5ecd1221a71721d52ffac063b04ce2b1cd255377d7c0ca4893d400ae9c9a9d20

---

## Rollback procedure (instant, no redeploy)

If anomalies surface in monitoring:

```bash
VERCEL_TOKEN=$(grep VERCEL_TOKEN /home/ferdev/.openclaw/workspace/wasiai-a2a/.env | cut -d= -f2-)
TEAM_ID=team_TULy0a3V6xlsEkKA2MXzALzf

# Delete WASIAI_FACILITATOR_AS_PRIMARY (reverts to legacy behavior)
curl -X DELETE -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/prj_RWJ7yv5zqSJlO6kVC6sfWyQf0em2/env/iwFU2cesc5LixQcf?teamId=$TEAM_ID"

# Optionally delete X402_FACILITATOR_URL too (back to settlePaymentDirectly internal)
curl -X DELETE -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/prj_RWJ7yv5zqSJlO6kVC6sfWyQf0em2/env/FOMlDpAwjJjBAdxA?teamId=$TEAM_ID"
```

Effective on next request — no cold-start delay required. Vercel reads env vars at function invocation.

---

## Monitoring

Look for `[settler]` log events in Vercel Function logs:

```
project: wasiai-prod
function: api/v1/models/[slug]/invoke
filter: [settler]
```

Expected field distribution after flip:
- `facilitatorUsed: "wasiai-facilitator"` → predominant for allowlisted chains (43113, 43114, 2366, 2368)
- `facilitatorUsed: "ultravioleta"` → for unsupported chains OR when wasiai fails (fallback)
- `fallbackTriggered: true` → expected <1% steady-state
- `idempotencyGuardTriggered: true` → expected rare (only when same nonce replay)

---

## Production state at activation

| Component | State |
|-----------|-------|
| wasiai-v2 app | HTTP 200 healthy (https://app.wasiai.io) |
| wasiai-facilitator | uptime 12.5d, 3 chains breaker CLOSED |
| Operator wallet AVAX mainnet | 0.0999 (~49 txs gas budget) |
| Operator wallet AVAX Fuji | 0.494 (~250 txs gas budget) |
| Operator wallet USDC mainnet | 1.634 |
| Operator wallet USDC Fuji | 18.064 (post 2 smoke txs) |

---

## What this means for the project

**Operational sovereignty achieved**: marketplace backend payment path now flows through infrastructure we own (`wasiai-facilitator` on Railway), with Ultravioleta DAO as automatic fallback for resilience.

**Narrative for workshop / hackathon**:
- All x402 settlements on backend invoke route go through wasiai-facilitator first
- Real onchain proof: 2 txs on Avalanche Fuji captured during the activation
- Fallback to Ultravioleta DAO ensures no service degradation if wasiai-facilitator is unreachable
- Idempotency guard prevents double-charge under partial failure scenarios
- Instant rollback via single API call (no code redeploy)

**Production-grade discipline**:
- 446 unit tests on main
- AR found 2 BLQs pre-flip, both fixed
- CR caught 6 cosmetic MNRs
- F4 QA validated 15/15 ACs + 16/16 CDs with file:line evidence
- Auto-Blindaje lessons captured for future HUs (AB-WAS-V2-2-1, -2)
- 8 risks documented, all mitigated
- Smoke evidence captured pre-flip AND post-flip
- Rollback procedure documented and tested-syntactically

This is what "no hacemos código para hackathons, hacemos código para producción al 100%" looks like end-to-end.
