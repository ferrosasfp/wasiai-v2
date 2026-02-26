import type { HttpClient } from './client'
import type { Agent, AgentList, AgentListOptions } from './types'
import { assertSlug } from './utils'

export class AgentsResource {
  constructor(private readonly http: HttpClient) {}

  async list(opts: AgentListOptions = {}): Promise<AgentList> {
    const params = new URLSearchParams()
    if (opts.page !== undefined) params.set('page', String(opts.page))
    if (opts.category !== undefined) params.set('category', opts.category)
    const qs = params.toString()
    const path = `/api/v1/agents${qs ? `?${qs}` : ''}`
    return this.http.request<AgentList>('GET', path)
  }

  async get(slug: string): Promise<Agent> {
    assertSlug(slug)
    return this.http.request<Agent>('GET', `/api/v1/agents/${slug}`)
  }
}
