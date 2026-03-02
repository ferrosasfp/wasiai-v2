# WasiAI Marketplace — Audit Package
> Prepared for external security review · 2026-03-01
> Contact: ferrosasfp · Network: Avalanche Fuji (testnet) → C-Chain (mainnet target)

---

## 1. Project Overview

WasiAI is a Web3 AI agent marketplace on Avalanche. Creators register AI agents and set prices; consumers pay in USDC per invocation. The smart contract handles:

- Agent registration and pricing
- USDC payment collection (x402 protocol + Agent Key budget system)
- Revenue distribution (creator share + platform fee)
- Trustless emergency exit for users

**Fuji testnet contract:** `0x2194A504B8203F2BbD8CcD33E99Ac803Eb1358Cb`
**USDC (Fuji):** `0x5425890298aed601595a70AB815c96711a31Bc65`
**USDC (Mainnet):** `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E`

---

## 2. Contract Architecture

### Roles
| Role | Address | Capabilities |
|---|---|---|
| Owner | `0x94DCDb84207724A609B17e4838936832EA59B9eD` | setPlatformFee, setOperator, setTreasury, transferOwnership |
| Operator | `0xf432baf1315ccDB23E683B95b03fD54Dd3e447Ba` | registerAgent, recordInvocation, settleKeyBatch, refundKeyToEarnings |
| Treasury | `0x1d024Bdb20B4c3E139B8516ed6d834a9654F21cF` | Receives platform fee share |
| Creator | Any address | withdraw() earnings |
| Key Owner | Any address | depositToKey(), emergencyWithdraw() |

### Payment Flows

**Flow A — x402 Direct Payment:**
```
Consumer → USDC transfer to contract → recordInvocation() →
  earnings[creator] += creatorShare
  usdc.safeTransfer(treasury, platformShare)
```

**Flow B — Agent Key (Budget System):**
```
Consumer → depositToKey() → keyBalances[keyId] += amount
Backend → settleKeyBatch() daily →
  keyBalances[keyId] -= total
  earnings[creator] += creatorShare (per agent)
  usdc.safeTransfer(treasury, totalPlatformShare)
Creator → withdraw() → usdc.safeTransfer(creator, amount)
```

### Key Invariants
1. `keyBalances[keyId] >= 0` always (checked before deduction)
2. `earnings[creator] >= 0` always
3. `totalVolume` monotonically increases
4. `platformFeeBps <= 3000` (30% max, enforced in setPlatformFee)
5. `creatorFeeBps = 10000 - platformFeeBps`
6. Idempotency: `usedPaymentIds[paymentId]` prevents double-spend in recordInvocation

---

## 3. Security Properties

### Reentrancy Protection
- `nonReentrant` modifier on: `recordInvocation`, `settleKeyBatch`, `refundKeyToEarnings`, `withdraw`, `emergencyWithdraw`, `depositToKey`
- Uses OpenZeppelin `ReentrancyGuard` (v5.2.0)

### Access Control
- `onlyOwner`: fee changes, operator management, treasury update
- `onlyOperator`: agent registration, invocation recording, batch settlement
- No modifiers: `withdraw`, `depositToKey`, `emergencyWithdraw`, `checkUpkeep`, `performUpkeep`

### Anti-Double-Spend
- `recordInvocation` requires `bytes32 paymentId` — stored in `usedPaymentIds` mapping
- `paymentId = keccak256(abi.encodePacked(txHash, slug))` generated off-chain

### Emergency Exit
- After `EMERGENCY_TIMEOUT = 30 days` without operator activity
- `emergencyWithdraw(keyId)` allows key owners to exit trustlessly
- Bypasses operator requirement — anyone can call for their own key

### Batch Settlement Safety
- `settleKeyBatch()` deducts full `total` atomically BEFORE loop (prevents partial settlement)
- Single `safeTransfer` to treasury AFTER loop (avoids gas blowup)
- Validates `slugs.length == amounts.length` and `slugs.length > 0`

---

## 4. Known Limitations & Design Decisions

### Centralization Risks
- Operator is a hot wallet (required for automated backend settlement)
- Owner can change platformFeeBps up to 30% at any time
- No timelock on fee changes (considered for v2)

### Off-chain Dependency
- `settleKeyBatch()` relies on off-chain data (DB records of calls per key)
- If operator is compromised, they could settle incorrect amounts
- Mitigated by: 30-day emergency exit, transparent on-chain event log

### Chainlink Automation
- `checkUpkeep`/`performUpkeep` implemented as trigger/signal only
- `performUpkeep` does NOT execute settlement directly — emits event for backend
- Real settlement still requires operator wallet signature

---

## 5. Test Coverage

**Total tests: 63 (all passing)**

| Suite | Tests | Coverage |
|---|---|---|
| WasiAIMarketplace.t.sol | 47 | Core marketplace logic |
| NFT tests | 8 | ERC-721 identity tokens |
| Token tests | 8 | ERC-20 WASI token |

### Key Test Scenarios
- `test_RecordInvocation_IdempotencyGuard` — double-spend prevention
- `test_SettleKeyBatch_AtomicDeduction` — reentrancy safety
- `test_EmergencyWithdraw_AfterTimeout` — trustless exit
- `testCheckUpkeepTrueAfterInterval` — Chainlink Automation
- `testPerformUpkeepRevertsBeforeInterval` — upkeep interval guard

---

## 6. Dependencies

| Library | Version | Usage |
|---|---|---|
| OpenZeppelin Contracts | 5.2.0 | ReentrancyGuard, Ownable, SafeERC20, IERC20 |
| forge-std | latest | Testing framework |

No external Chainlink dependencies — IAutomationCompatibleInterface implemented inline.

---

## 7. Scope for Audit

**In scope:**
- `contracts/src/WasiAIMarketplace.sol` (505 lines)
- All functions and modifiers
- Payment flows A and B
- Emergency exit mechanism
- Chainlink Automation integration

**Out of scope:**
- Frontend/API code
- Off-chain settlement logic
- ERC-721 NFT contract (separate deployment)
- ERC-20 WASI token contract (separate deployment)

---

## 8. Areas of Concern (Self-identified)

| # | Area | Severity | Notes |
|---|---|---|---|
| 1 | Operator centralization | Medium | Hot wallet controls settlement — compromise = incorrect batch amounts |
| 2 | No timelock on fee changes | Low | Owner can change fee instantly — no warning period for users |
| 3 | `performUpkeep` callable by anyone | Info | Only effect is timestamp update — no fund movement |
| 4 | Off-chain paymentId generation | Low | If backend generates duplicate paymentIds, second call reverts (safe) |
| 5 | `settleKeyBatch` max batch size | Info | No upper bound — very large batches could hit gas limit |

---

## 9. How to Run Tests

```bash
# Install Foundry
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Clone and test
git clone https://github.com/ferrosasfp/wasiai-v2
cd wasiai-v2/contracts
forge install
forge test -vv
```

---

## 10. Contact & Resources

- **GitHub:** https://github.com/ferrosasfp/wasiai-v2
- **Contract (Fuji):** https://sourcify.dev/#/lookup/0x2194A504B8203F2BbD8CcD33E99Ac803Eb1358Cb
- **Docs:** https://wasiai-v2.vercel.app/en/docs

---

*This document was prepared by the WasiAI development team for external security review. All findings should be reported before mainnet deployment.*
