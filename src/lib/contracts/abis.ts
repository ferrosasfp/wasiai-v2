/**
 * ABI constants shared between frontend (client) and backend (server).
 * MUST NOT import any server-only modules.
 */

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
