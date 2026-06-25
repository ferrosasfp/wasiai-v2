/**
 * usdc.ts — Integer (atomic) USDC arithmetic helpers.
 *
 * WHY (audit V4 — KEY_BALANCE_MISMATCH):
 * USDC has 6 decimals. Handling dollar amounts as IEEE-754 `number` and summing
 * them (`amounts.reduce((a,b)=>a+b,0)`) or computing fees (`amount * bps / 10000`)
 * in floats accumulates binary rounding error. Over a batch this desyncs the
 * off-chain earnings ledger from the on-chain escrow and trips the
 * `KEY_BALANCE_MISMATCH` guard in runSettlement.
 *
 * FIX: do all accumulation / fee / comparison math in **atomic micro-USDC**
 * (`bigint`, units of 1e-6 USDC). Convert at the edges only (DB string ↔ compute,
 * number price ↔ compute). The x402 wire / contract args already use atomic
 * strings — those are NOT touched; this is purely the internal JS accounting.
 *
 * ROUNDING CONVENTION:
 *  - `toAtomic`: rounds a dollar value to the nearest micro-USDC unit
 *    (`Math.round(dollars * 1e6)`). This is byte-for-byte identical to the
 *    on-chain `toUSDCAtomics()` so the per-call atomic amount we sum off-chain
 *    matches exactly the atomic amount the contract escrows. Summing the
 *    already-rounded per-call integers (not re-rounding a float sum) is what
 *    removes the drift.
 *  - `feeSplit`: the **fee is floored** (`(amount * bps) / 10000n`, integer
 *    division truncates toward zero), and the **creator receives the remainder**
 *    (`amount - fee`). No micro-USDC unit is ever lost or created:
 *    `fee + creator === amount` exactly, for every input. Flooring the fee biases
 *    the sub-unit remainder to the creator, never to the platform — chosen so the
 *    creator is never short-changed and the platform never over-collects.
 */

const MICRO_PER_USDC = 1_000_000n
const BPS_DENOMINATOR = 10_000n

/**
 * Convert a USDC dollar amount (number or numeric-string from the DB) to atomic
 * micro-USDC (bigint, 6 decimals).
 *
 * - number  → rounded to nearest micro-unit (matches on-chain toUSDCAtomics).
 * - string  → parsed exactly from its decimal representation (no float round-trip)
 *   when it is a plain decimal; falls back to float parse for exponential/other
 *   forms. DB `numeric(20,6)` columns arrive as plain decimal strings, so the
 *   exact path is used and there is zero precision loss.
 *
 * @throws if the value is not a finite, parseable number.
 */
export function toAtomic(usdc: number | string): bigint {
  if (typeof usdc === 'number') {
    if (!Number.isFinite(usdc)) {
      throw new Error(`toAtomic: non-finite number ${usdc}`)
    }
    return BigInt(Math.round(usdc * 1_000_000))
  }

  const trimmed = usdc.trim()
  if (trimmed === '') throw new Error('toAtomic: empty string')

  // Exact decimal parse for plain "[-]int[.frac]" strings — avoids float error
  // for DB numeric(20,6) values (e.g. "0.123456" → 123456n exactly).
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed)
  if (m) {
    const sign = m[1] === '-' ? -1n : 1n
    const intPart = m[2] ?? '0'
    const fracRaw = m[3] ?? ''
    // Pad/truncate fractional part to exactly 6 digits (round the 7th+).
    const frac6 = fracRaw.slice(0, 6).padEnd(6, '0')
    let atomic = BigInt(intPart) * MICRO_PER_USDC + BigInt(frac6)
    // Round based on the 7th fractional digit if present.
    const seventh = fracRaw[6]
    if (seventh !== undefined && Number(seventh) >= 5) {
      atomic += 1n
    }
    return sign * atomic
  }

  // Fallback for exponential / non-plain forms.
  const n = Number(trimmed)
  if (!Number.isFinite(n)) throw new Error(`toAtomic: unparseable string "${usdc}"`)
  return BigInt(Math.round(n * 1_000_000))
}

/**
 * Convert atomic micro-USDC (bigint) back to a fixed-6-decimal USDC string,
 * suitable for display and for writing to numeric(20,6) DB columns.
 *
 * e.g. 123456n → "0.123456", 1_000_000n → "1.000000", -5n → "-0.000005".
 */
export function fromAtomic(atomic: bigint): string {
  const neg = atomic < 0n
  const abs = neg ? -atomic : atomic
  const whole = abs / MICRO_PER_USDC
  const frac = abs % MICRO_PER_USDC
  const fracStr = frac.toString().padStart(6, '0')
  return `${neg ? '-' : ''}${whole.toString()}.${fracStr}`
}

/**
 * Split an atomic amount into platform fee and creator share using basis points.
 *
 * Fee is floored (integer division); creator gets the exact remainder so that
 * `fee + creator === amount` with no micro-USDC lost. See file header for the
 * rounding-direction rationale.
 *
 * @param amountAtomic total amount in micro-USDC (must be >= 0n)
 * @param feeBps       platform fee in basis points (0..10000)
 */
export function feeSplit(
  amountAtomic: bigint,
  feeBps: number,
): { fee: bigint; creator: bigint } {
  if (amountAtomic < 0n) throw new Error('feeSplit: negative amount')
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error(`feeSplit: feeBps out of range: ${feeBps}`)
  }
  const fee = (amountAtomic * BigInt(feeBps)) / BPS_DENOMINATOR // floor
  const creator = amountAtomic - fee
  return { fee, creator }
}

/**
 * Sum a list of USDC amounts (numbers or numeric-strings) with zero float drift.
 * Each value is converted to atomic micro-USDC first, then summed as integers.
 * This mirrors the on-chain `sum(toUSDCAtomics(a_i))` exactly.
 */
export function sumAtomic(amounts: ReadonlyArray<number | string>): bigint {
  let total = 0n
  for (const a of amounts) total += toAtomic(a)
  return total
}
