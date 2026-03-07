/**
 * WasiAIMarketplace contract ABI + helpers
 * Chain: Avalanche C-Chain (43114) / Fuji testnet (43113)
 */

export const WASIAI_MARKETPLACE_ABI = [
  // ── Registry ──────────────────────────────────────────────────────────────
  {
    name: 'registerAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'slug',         type: 'string'  },
      { name: 'pricePerCall', type: 'uint256' },
      { name: 'creator',      type: 'address' },
      { name: 'erc8004Id',    type: 'uint64'  },
    ],
    outputs: [],
  },
  // NA-301: Registration fee getter
  {
    name: 'registrationFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // NA-301b: Free registrations per user
  {
    name: 'freeRegistrationsPerUser',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'userRegistrationCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // WAS-160g: Self-registration — creator signs and pays gas directly
  {
    name: 'selfRegisterAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'slug',         type: 'string'  },
      { name: 'pricePerCall', type: 'uint256' },
      { name: 'erc8004Id',    type: 'uint64'  },
    ],
    outputs: [],
  },
  {
    name: 'updateAgent',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'slug',     type: 'string'  },
      { name: 'newPrice', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'getAgent',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'slug', type: 'string' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'creator',       type: 'address' },
          { name: 'pricePerCall',  type: 'uint256' },
          { name: 'erc8004Id',     type: 'uint64'  },
          // NA-207: creatorFeeBps removido del contrato (dead storage)
          // WAS-161: active removido — status se controla en Supabase
        ],
      },
    ],
  },
  // ── Invocation ────────────────────────────────────────────────────────────
  {
    name: 'recordInvocation',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'slug',      type: 'string'  },
      { name: 'payer',     type: 'address' },
      { name: 'amount',    type: 'uint256' },
      { name: 'paymentId', type: 'bytes32' },
    ],
    outputs: [],
  },
  // ── Withdrawal ────────────────────────────────────────────────────────────
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'withdrawFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'creator', type: 'address' }],
    outputs: [],
  },
  {
    name: 'getPendingEarnings',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'creator', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  // ── Stats ─────────────────────────────────────────────────────────────────
  {
    name: 'getStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'volume',      type: 'uint256' },
      { name: 'invocations', type: 'uint256' },
      { name: 'feeBps',      type: 'uint16'  },
    ],
  },
  {
    name: 'platformFeeBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint16' }],
  },
  // NA-001: fee timelock 2-step (setPlatformFee eliminado del contrato)
  {
    name: 'proposeFee',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'bps', type: 'uint16' }],
    outputs: [],
  },
  {
    name: 'executeFee',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'cancelFee',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'pendingFeeBps',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint16' }],
  },
  {
    name: 'pendingFeeTimestamp',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  // ── Events ────────────────────────────────────────────────────────────────
  {
    name: 'AgentRegistered',
    type: 'event',
    inputs: [
      { name: 'slug',         type: 'string',  indexed: true  },
      { name: 'creator',      type: 'address', indexed: true  },
      { name: 'pricePerCall', type: 'uint256', indexed: false },
      { name: 'erc8004Id',    type: 'uint64',  indexed: false },
    ],
  },
  {
    name: 'AgentInvoked',
    type: 'event',
    inputs: [
      { name: 'slug',          type: 'string',  indexed: true  },
      { name: 'payer',         type: 'address', indexed: true  },
      { name: 'amount',        type: 'uint256', indexed: false },
      { name: 'creatorShare',  type: 'uint256', indexed: false },
      { name: 'platformShare', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'Withdrawn',
    type: 'event',
    inputs: [
      { name: 'creator', type: 'address', indexed: true  },
      { name: 'amount',  type: 'uint256', indexed: false },
    ],
  },
  // ── Pre-funded Key Functions ───────────────────────────────────────────────
  {
    name: 'depositForKey',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keyId',       type: 'bytes32' },
      { name: 'owner',       type: 'address' },
      { name: 'amount',      type: 'uint256' },
      { name: 'validAfter',  type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
      { name: 'v',           type: 'uint8'   },
      { name: 'r',           type: 'bytes32' },
      { name: 's',           type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'settleKeyBatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keyId',   type: 'bytes32'   },
      { name: 'slugs',   type: 'string[]'  },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    name: 'refundKeyToEarnings',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keyId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'emergencyWithdrawKey',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'keyId', type: 'bytes32' }],
    outputs: [],
  },
  {
    name: 'getKeyBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'keyId', type: 'bytes32' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'keyOwners',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'keyId', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'lastOperatorActivity',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  // ── Chainlink Automation ────────────────────────────────────────────────
  {
    name: 'checkUpkeep',
    type: 'function',
    stateMutability: 'view',
    inputs:  [{ name: 'checkData', type: 'bytes' }],
    outputs: [
      { name: 'upkeepNeeded', type: 'bool'  },
      { name: 'performData',  type: 'bytes' },
    ],
  },
  {
    name: 'performUpkeep',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs:  [{ name: 'performData', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'lastUpkeepTimestamp',
    type: 'function',
    stateMutability: 'view',
    inputs:  [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'UpkeepPerformed',
    type: 'event',
    inputs: [
      { name: 'timestamp', type: 'uint256', indexed: true  },
      { name: 'performer', type: 'address', indexed: true  },
    ],
  },
  // ── Pre-funded Key Events ─────────────────────────────────────────────────
  {
    name: 'KeyFunded',
    type: 'event',
    inputs: [
      { name: 'keyId',  type: 'bytes32', indexed: true  },
      { name: 'owner',  type: 'address', indexed: true  },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'KeyCallSettled',
    type: 'event',
    inputs: [
      { name: 'keyId',         type: 'bytes32', indexed: true  },
      { name: 'slug',          type: 'string',  indexed: false },
      { name: 'amount',        type: 'uint256', indexed: false },
      { name: 'creatorShare',  type: 'uint256', indexed: false },
      { name: 'platformShare', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'KeyRefunded',
    type: 'event',
    inputs: [
      { name: 'keyId',  type: 'bytes32', indexed: true  },
      { name: 'owner',  type: 'address', indexed: true  },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  // NA-202: Treasury timelock — proposeTreasury / executeTreasury / cancelTreasury
  {
    name: 'proposeTreasury',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_treasury', type: 'address' }],
    outputs: [],
  },
  {
    name: 'executeTreasury',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'cancelTreasury',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'pendingTreasury',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'pendingTreasuryTimestamp',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'TreasuryProposed',
    type: 'event',
    inputs: [
      { name: 'proposed',     type: 'address', indexed: true  },
      { name: 'executeAfter', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'TreasuryCanceled',
    type: 'event',
    inputs: [
      { name: 'canceledProposal', type: 'address', indexed: true },
    ],
  },
  // WAS-141: Creator withdraws USDC directly from key balance
  {
    name: 'withdrawKey',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keyId',  type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'KeyWithdrawn',
    type: 'event',
    inputs: [
      { name: 'keyId',  type: 'bytes32', indexed: true  },
      { name: 'owner',  type: 'address', indexed: true  },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  // ── ERC-8004 Reputation Batch ─────────────────────────────────────────────
  {
    name: 'submitReputationBatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'slugs',      type: 'string[]' },
      { name: 'avgRatings', type: 'uint16[]' },
      { name: 'voteCounts', type: 'uint32[]' },
    ],
    outputs: [],
  },
  {
    name: 'getReputation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'slug', type: 'string' }],
    outputs: [
      { name: 'avgRating',   type: 'uint16' },
      { name: 'voteCount',   type: 'uint32' },
      { name: 'lastUpdated', type: 'uint64' },
    ],
  },
  {
    name: 'ReputationBatchSubmitted',
    type: 'event',
    inputs: [
      { name: 'batchSize', type: 'uint256', indexed: true  },
      { name: 'timestamp', type: 'uint256', indexed: true  },
    ],
  },
] as const

// ── Contract address helper ────────────────────────────────────────────────

export const MARKETPLACE_ADDRESSES: Record<number, `0x${string}`> = {
  43114: (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  43113: (process.env.NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI    ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
}

export function getMarketplaceAddress(chainId: number): `0x${string}` {
  return MARKETPLACE_ADDRESSES[chainId] ?? '0x0000000000000000000000000000000000000000'
}

/** Convert USDC dollar amount to atomic units (6 decimals) */
export function toUSDCAtomics(dollars: number): bigint {
  return BigInt(Math.round(dollars * 1_000_000))
}

/** Convert USDC atomic units back to dollars */
export function fromUSDCAtomics(atomics: bigint): number {
  return Number(atomics) / 1_000_000
}
