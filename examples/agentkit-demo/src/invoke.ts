// Invoca un agente WasiAI via HTTP POST con el header X-402-Payment.
// Implementa el flujo x402: si el server devuelve 402, es un error de pago
// (la firma ya viene construida antes de llamar — no hay retry automático en v1).

import { buildX402Header, type ERC3009Payment } from './pay.js'

export interface InvokeParams {
  invokeUrl: string
  payment:   ERC3009Payment
  input:     string
}

export interface InvokeResult {
  txHash:    string
  output:    string
  elapsed:   number
  rawStatus: number
}

export async function invokeAgent(params: InvokeParams): Promise<InvokeResult> {
  const { invokeUrl, payment, input } = params
  const t0 = Date.now()

  const x402Header = buildX402Header(payment)

  let res: Response
  try {
    res = await fetch(invokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'X-402-Payment':   x402Header,
      },
      body: JSON.stringify({ input }),
    })
  } catch (err) {
    throw new Error(`Network error invoking agent at '${invokeUrl}': ${String(err)}`)
  }

  const rawStatus = res.status

  if (res.status === 402) {
    // x402 challenge — loguear los detalles del payment requirement para diagnóstico
    const body = await res.text().catch(() => '')
    throw new Error(
      `x402 Payment Required [402] — el pago fue rechazado o inválido.\n` +
      `Server response: ${body}\n` +
      `Verifica que la wallet tenga USDC Fuji suficiente y que la firma sea válida.`
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Invoke failed [${res.status}]: ${body}`)
  }

  const data = await res.json()

  return {
    txHash:    data.tx_hash  ?? data.txHash  ?? 'n/a',
    output:    data.output   ?? data.result  ?? data.summary ?? JSON.stringify(data),
    elapsed:   Date.now() - t0,
    rawStatus,
  }
}
