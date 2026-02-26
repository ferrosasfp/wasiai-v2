import { AgentsResource } from './agents'
import { HttpClient } from './client'
import { invokeAgent } from './invoke'
import type { InvokeResult, WasiAIOptions } from './types'

export class WasiAI {
  readonly agents: AgentsResource
  private readonly http: HttpClient

  constructor(options: WasiAIOptions) {
    this.http = new HttpClient(options)
    this.agents = new AgentsResource(this.http)
  }

  invoke(slug: string, input: Record<string, unknown>): Promise<InvokeResult> {
    return invokeAgent(this.http, slug, input)
  }
}

export type { Agent, AgentList, AgentListOptions, InvokeResult, WasiAIOptions } from './types'
export { AgentNotFoundError, InsufficientBudgetError, RateLimitError, WasiAIError } from './errors'
export type { AgentsResource } from './agents'
