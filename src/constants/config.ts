/**
 * config.ts — Application-wide magic numbers and constants
 *
 * T-14: Centralizes all magic numbers to avoid scattered literals and
 *       make business rules explicit and easy to update.
 */

// ── Payment / x402 ────────────────────────────────────────────────────────────

/** USDC uses 6 decimal places (1 USDC = 1,000,000 atomicUnits) */
export const USDC_DECIMALS = 6
export const USDC_MULTIPLIER = 10 ** USDC_DECIMALS // 1_000_000

/** Maximum time (seconds) a payment lock remains valid */
export const PAYMENT_TIMEOUT_SECONDS = 300

/** Revenue split: creator receives 90%, WasiAI takes 10% */
export const CREATOR_REVENUE_SHARE = 0.90
export const PLATFORM_FEE = 0.10

// ── API limits ────────────────────────────────────────────────────────────────

/** Default page size for list endpoints */
export const DEFAULT_PAGE_SIZE = 20

/** Maximum page size for list endpoints */
export const MAX_PAGE_SIZE = 100

/** Upstream model call timeout (ms) — prevents hanging requests */
export const UPSTREAM_TIMEOUT_MS = 10_000

// ── Storage ───────────────────────────────────────────────────────────────────

/** Maximum file size for uploads: 10MB */
export const MAX_FILE_SIZE_BYTES = 10_000_000

/** Maximum files per user (future use) */
export const MAX_FILES_PER_USER = 100

// ── Chain IDs ─────────────────────────────────────────────────────────────────
// Note: Canonical chain config lives in src/lib/chain.ts — these are for quick
// comparisons without importing the full chain module.

export const AVALANCHE_MAINNET_CHAIN_ID = 43114
export const AVALANCHE_FUJI_CHAIN_ID = 43113

// ── Agent keys ────────────────────────────────────────────────────────────────

/** Maximum budget an agent key can hold (USDC) */
export const MAX_AGENT_KEY_BUDGET_USDC = 1_000

/** Minimum budget when creating an agent key (USDC) */
export const MIN_AGENT_KEY_BUDGET_USDC = 1

// ── ISR / Cache ───────────────────────────────────────────────────────────────

/** Homepage ISR revalidation (seconds) */
export const HOME_REVALIDATE_SECONDS = 300

/** Public API CDN cache (seconds) */
export const API_CACHE_MAX_AGE = 300

/** CDN stale-while-revalidate window (seconds) */
export const API_CACHE_SWR = 600

// ── Model discovery ───────────────────────────────────────────────────────────

/** Number of models shown on homepage */
export const HOME_PAGE_SIZE = 12

/** Max models in MCP tool list */
export const MCP_MODEL_LIMIT = 50

/** Minimum price per call (USDC) */
export const MIN_PRICE_PER_CALL = 0.01

/** Maximum price per call (USDC) */
export const MAX_PRICE_PER_CALL = 100
