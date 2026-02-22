// ═══════════════════════════════════════════════════════════════════
// @wasiai/sdk — Types
// ═══════════════════════════════════════════════════════════════════

export type AgentCategory =
  | 'nlp'
  | 'vision'
  | 'audio'
  | 'code'
  | 'multimodal'
  | 'data'
  | 'finance'
  | 'other'

export type AgentType = 'model' | 'agent' | 'workflow'

export interface AgentCapability {
  name: string
  description: string
  input?: Record<string, string>
  output?: Record<string, string>
}

/** Config que el builder pasa a createAgent() */
export interface AgentConfig {
  /** Nombre visible en el marketplace */
  name: string

  /** Descripción para humanos y agentes */
  description: string

  /** Categoría del agente */
  category: AgentCategory

  /** Precio por llamada en USDC (default: 0.001) */
  price?: number

  /** Tipo de agente (default: 'agent') */
  type?: AgentType

  /** Capacidades machine-readable */
  capabilities?: AgentCapability[]

  /** Nombre del tool MCP (snake_case) */
  mcpToolName?: string

  /** URL de tu agente en producción — si no se pasa, WasiAI la infiere del registro */
  endpointUrl?: string

  /** Wallet Avalanche para recibir pagos on-chain */
  creatorWallet?: string

  /** URL del marketplace WasiAI (default: https://wasiai.vercel.app) */
  marketplaceUrl?: string
}

/** Lo que el builder recibe en su handler */
export interface AgentRequest<T = Record<string, unknown>> {
  /** Body parseado del request */
  input: T

  /** Metadata del pago verificado (cuando viene por x402) */
  payment?: {
    txHash: string | null
    amount: number
    payer: string | null
  }

  /** Metadata del agent key (cuando viene por x-agent-key) */
  agentKey?: {
    id: string
    remaining: number
  }
}

/** Lo que el handler del builder debe devolver */
export interface AgentResponse<T = unknown> {
  output: T
  /** Metadatos opcionales que se incluyen en la respuesta */
  meta?: Record<string, unknown>
}

/** Función handler del builder */
export type AgentHandler<TInput = Record<string, unknown>, TOutput = unknown> = (
  req: AgentRequest<TInput>,
) => Promise<AgentResponse<TOutput>> | AgentResponse<TOutput>

/** Configuración x402 para verificación de pagos */
export interface X402Config {
  /** Wallet treasury de WasiAI que recibe los pagos (se obtiene del marketplace) */
  treasury: string
  /** URL del facilitator (default: https://facilitator.ultravioletadao.xyz) */
  facilitatorUrl?: string
  /** Chain name (default: 'avalanche') */
  chain?: string
}

/** Resultado del registro en WasiAI */
export interface PublishResult {
  success: boolean
  slug?: string
  marketplaceUrl?: string
  invokeUrl?: string
  error?: string
}
