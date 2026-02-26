export class WasiAIError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'WasiAIError'
  }
}

export class RateLimitError extends WasiAIError {
  constructor() {
    super('Rate limit exceeded')
    this.name = 'RateLimitError'
  }
}

export class InsufficientFundsError extends WasiAIError {
  constructor() {
    super('Insufficient funds in API key')
    this.name = 'InsufficientFundsError'
  }
}

export class AgentNotFoundError extends WasiAIError {
  constructor(slug: string) {
    super(`Agent "${slug}" not found`)
    this.name = 'AgentNotFoundError'
  }
}

export class TimeoutError extends WasiAIError {
  constructor() {
    super('Request timed out')
    this.name = 'TimeoutError'
  }
}
