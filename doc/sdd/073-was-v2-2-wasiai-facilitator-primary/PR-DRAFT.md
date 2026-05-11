# PR Draft — feat/was-v2-2-wasiai-facilitator-primary

## Creation Command

```bash
gh pr create --title "feat(WAS-V2-2): wasiai-facilitator as primary x402 settler with UVD fallback" --body "$(cat <<'EOF'
## Summary

Introduces dual-facilitator router for USDC x402 settlements. When flag `WASIAI_FACILITATOR_AS_PRIMARY=true` (prod default: false), wasiai-facilitator is tried first on allowlisted chains; transparently falls back to Ultravioleta DAO on 5xx/timeout/known errors. Critically prevents double-charge via idempotency guard when nonce already consumed. Zero regression with flag OFF—all 410 baseline tests pass.

- New `facilitator-router.ts` module: 380 LOC, pure functions, no runtime state
- 22 new unit tests covering full routing matrix (toggle × allowlist × wasiai/uvd ok/fail)
- `usdcSettler.settlePaymentX402()` becomes thin delegator (public signature unchanged)
- Telemetry: single structured `[settler]` log per settlement with facilitator/fallback metadata
- `.env.example` extended with routing documentation

## Implementation Stats

| Metric | Value |
|--------|-------|
| New files | 1 (`facilitator-router.ts` + tests) |
| Modified files | 5 (config, settler, client, tests, env) |
| Total diff | +1,320 insertions, -165 deletions |
| New tests | 30 (22 router + 6 config + 2 client) |
| Test result | 446 passed \| 1 skipped \| 0 failed |
| Baseline regression | 0 (all 410 WAS-V2-1 tests pass) |

## Critical Design Locks

- **Idempotency guard (AC-10):** If wasiai responds `NONCE_ALREADY_USED` (HTTP 409 or body code), router **never** calls Ultravioleta → prevents on-chain double-spend
- **Feature flag default:** `false` (safe merge; ops flips when ready post-smoke-testing)
- **Chain allowlist:** Hardcoded immutable set—no dynamic discovery calls
- **Telemetry:** Single log per settlement (Grafana histogram accuracy)
- **Error classification:** 5 mutually exclusive categories → defensive fallback chain for unknowns

## Post-Merge Operations

⚠️ **DO NOT enable immediately.** Steps for ops:

1. In Vercel preview: set `WASIAI_FACILITATOR_AS_PRIMARY=true`
2. Verify wasiai-facilitator Railway has `OPERATOR_PRIVATE_KEY`
3. Smoke test: settle $0.01 USDC on Fuji; check logs for no `fallback_reason`
4. If stable 24h in preview: prod canary (1% traffic)
5. If stable 24h canary: prod 100%
6. Rollback: flip flag to `false` (no code redeploy)

## Testing Checklist

- [x] `npm test -- --run` → 446 passed | 1 skipped (zero regression)
- [x] `npm run typecheck` → exit 0
- [x] `npm run lint` → exit 0
- [x] All 15 ACs traceable to named tests
- [x] All 16 CDs verified (CD-14 append-only confirmed via git diff)
- [x] Auto-Blindaje lessons captured (CD strictness, AbortSignal lifecycle)

## Files & Artifacts

- **Implementation:** 6 commits (F3 waves + AR/CR fixes) already merged to branch
- **Final Report:** `doc/sdd/073-was-v2-2-wasiai-facilitator-primary/done-report.md`
- **Index Update:** `doc/sdd/_INDEX.md` status → DONE

---

Generated with Claude Code (nexus-docs phase DONE)
EOF
)"
```

## Title

`feat(WAS-V2-2): wasiai-facilitator as primary x402 settler with UVD fallback`

## Base Branch

`main`

## Head Branch

`feat/was-v2-2-wasiai-facilitator-primary`

---

## Commits Included (7 total)

| Hash | Message |
|------|---------|
| `f7211daae` | W0 — extend facilitator config helpers + NONCE_ALREADY_USED code |
| `df11e6b61` | W1 — facilitator-router with primary/fallback dispatch + tests |
| `1ad5eed1d` | W2 — usdcSettler delegates to router + env.example |
| `368a84739` | W4 — remove dead helpers in usdcSettler (BLQ-ALTO-1) |
| `867aede1d` | W4 — fresh AbortSignal for UVD fallback (BLQ-MED-1) |
| `32c71fae2` | W4 — auto-blindaje for fix-pack lessons |
| `e6ef907c5` | docs(WAS-V2-2): DONE — final report + _INDEX update |

---

## Verification

### Manual PR Creation (if gh CLI auth fails)

Go to: `https://github.com/ferrosasfp/wasiai-v2/compare/main...feat/was-v2-2-wasiai-facilitator-primary`

1. Click "Create pull request"
2. Paste the title from above
3. Paste the summary/body from the command above
4. Set base to `main`, head to `feat/was-v2-2-wasiai-facilitator-primary`
5. Request review from relevant parties

### CI Checks Expected to Pass

- GitHub Actions: `npm test -- --run` → 446 passed | 1 skipped
- GitHub Actions: `npm run typecheck` → exit 0
- GitHub Actions: `npm run lint` → exit 0
