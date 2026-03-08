/**
 * ABI constants shared between frontend (client) and backend (server).
 * MUST NOT import any server-only modules.
 */

export const WITHDRAW_EARNINGS_ABI = [
  {
    name:            'withdraw',
    type:            'function' as const,
    inputs:          [],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const

export const CLAIM_EARNINGS_ABI = [
  {
    name:            'claimEarnings',
    type:            'function' as const,
    inputs:          [
      { name: 'creator',     type: 'address' },
      { name: 'grossAmount', type: 'uint256' },
      { name: 'deadline',    type: 'uint256' },
      { name: 'nonce',       type: 'bytes32' },
      { name: 'sig',         type: 'bytes'   },
    ],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const

export const WITHDRAW_KEY_ABI = [
  {
    name:            'withdrawKey',
    type:            'function' as const,
    inputs:          [
      { name: 'keyId',  type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs:         [],
    stateMutability: 'nonpayable',
  },
] as const
