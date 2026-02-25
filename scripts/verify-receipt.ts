/**
 * Verifica un receipt_signature de la DB.
 *
 * Uso:
 *   npx tsx scripts/verify-receipt.ts <signature> <callId> <slug> <amountUsdc> <timestamp>
 *
 * Ejemplo:
 *   npx tsx scripts/verify-receipt.ts 0xabc... uuid-call-id text-summarizer 0.02 1708900000
 *
 * Salida:
 *   VALID   — la firma es del operador configurado
 *   INVALID — la firma no coincide
 */

import 'dotenv/config'
import { verifyReceipt } from '../src/lib/receipts/signReceipt'

const [,, signature, callId, agentSlug, amountUsdcStr, timestampStr] = process.argv

if (!signature || !callId || !agentSlug || !amountUsdcStr || !timestampStr) {
  console.error('Usage: npx tsx scripts/verify-receipt.ts <signature> <callId> <slug> <amountUsdc> <timestamp>')
  console.error('')
  console.error('Example:')
  console.error('  npx tsx scripts/verify-receipt.ts 0xabc... 550e8400-... text-summarizer 0.02 1708900000')
  process.exit(1)
}

if (!process.env.OPERATOR_PRIVATE_KEY) {
  console.error('Error: OPERATOR_PRIVATE_KEY not set in .env.local')
  process.exit(1)
}

// Convert keyId: for this script, we use a dummy keyId unless provided
// In production, the keyId comes from keyHashToBytes32(agent_keys.key_hash)
// Pass keyId as 6th arg if needed, defaults to zero bytes32
const keyId = process.argv[8] ?? '0x' + '0'.repeat(64)

const amountUsdc = parseFloat(amountUsdcStr)
const timestamp  = parseInt(timestampStr, 10)

if (isNaN(amountUsdc) || isNaN(timestamp)) {
  console.error('Error: amountUsdc and timestamp must be numbers')
  process.exit(1)
}

const receipt = { keyId, callId, agentSlug, amountUsdc, timestamp }

console.log('\n=== WasiAI Receipt Verifier ===')
console.log('Receipt:', JSON.stringify(receipt, null, 2))
console.log('Signature:', signature)
console.log('')

const valid = verifyReceipt(receipt, signature)

if (valid) {
  console.log('✅ VALID — la firma es del operador de WasiAI')
  process.exit(0)
} else {
  console.log('❌ INVALID — la firma no coincide con el operador')
  console.log('')
  console.log('Posibles causas:')
  console.log('  - OPERATOR_PRIVATE_KEY en .env.local es diferente al de producción')
  console.log('  - Los parámetros del recibo no coinciden exactamente con los de la llamada')
  console.log('  - La firma fue alterada')
  process.exit(1)
}
