export const VALID_PAYMENT_TYPES = ['api_key', 'x402', 'free_trial', 'sandbox', 'unknown'] as const
export type PaymentType = typeof VALID_PAYMENT_TYPES[number]

export function assertPaymentType(value: string): asserts value is PaymentType {
  if (!VALID_PAYMENT_TYPES.includes(value as PaymentType)) {
    throw new Error(`Invalid payment_type: ${value}`)
  }
}
