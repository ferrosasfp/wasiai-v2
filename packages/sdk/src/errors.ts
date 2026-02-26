export class WasiAIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message)
    this.name = 'WasiAIError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class InsufficientBudgetError extends WasiAIError {
  constructor(message = 'Insufficient budget to invoke agent') {
    super(message, 402)
    this.name = 'InsufficientBudgetError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class AgentNotFoundError extends WasiAIError {
  constructor(slug: string) {
    super(`Agent not found: ${slug}`, 404)
    this.name = 'AgentNotFoundError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class RateLimitError extends WasiAIError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 429)
    this.name = 'RateLimitError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
