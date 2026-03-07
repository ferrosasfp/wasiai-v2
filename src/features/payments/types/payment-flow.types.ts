/** Máquina de estados del flujo de pago — lineal, sin estados paralelos */
export type PaymentFlowState =
  | 'idle'                 // todo OK, esperando click del usuario
  | 'no_wallet'            // no hay wallet conectada
  | 'wrong_network'        // chainId ≠ 43113
  | 'switching_network'    // switchChain en progreso (spinner)
  | 'insufficient_balance' // USDC < price_per_call
  | 'signing_eip3009'      // signTypedData en progreso
  | 'eip3009_failed'       // EIP-3009 falló por incompatibilidad técnica → mostrar fallback
  | 'transferring'         // USDC.transfer directo (embedded wallets)
  | 'approving'            // writeContract(approve) en progreso
  | 'calling'              // fetch /invoke en vuelo
  | 'success'
  | 'error'

export interface PaymentFlowContext {
  state: PaymentFlowState
  /** Dirección hex de la wallet conectada (undefined si no hay) */
  address?: `0x${string}`
  /** chainId actual de la wallet */
  chainId?: number
  /** Nombre legible de la red actual */
  chainName?: string
  /** Balance USDC en unidades USDC (decimales ya aplicados, ej: 12.5) */
  usdcBalance?: number
  /** true si el balance alcanza para pagar el modelo */
  hasEnoughBalance: boolean
  /** true solo si EIP-3009 falló por motivo técnico (no por rechazo del usuario) */
  fallbackAvailable: boolean
  /** Resultado de la invocación al modelo (texto del agente) */
  result?: string
  /** Hash de la tx on-chain (EIP-3009 o approve) */
  txHash?: `0x${string}`
  /** Mensaje de error legible para mostrar al usuario */
  errorMessage?: string
}

export interface EIP712AuthorizationPayload {
  from:        `0x${string}`
  to:          `0x${string}`
  value:       string          // bigint serializado como string decimal
  validAfter:  string          // siempre '0'
  validBefore: string          // unix timestamp (now + 300s)
  nonce:       `0x${string}`  // 32 bytes hex aleatorios
}

export interface X402PaymentHeader {
  x402Version: 1
  scheme:      'exact'
  network:     string
  payload: {
    signature:     `0x${string}`
    authorization: EIP712AuthorizationPayload
  }
}

/** Body del 402 que devuelve el servidor */
export interface X402Requirements {
  network:           string
  asset:             `0x${string}`  // dirección USDC Fuji
  payTo:             `0x${string}`  // dirección del operador
  maxAmountRequired: string          // wei como string decimal
  x402Version?:      number
}
