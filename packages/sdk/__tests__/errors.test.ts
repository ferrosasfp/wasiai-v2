import { describe, it, expect } from 'vitest'
import {
  WasiAIError,
  RateLimitError,
  InsufficientFundsError,
  AgentNotFoundError,
  TimeoutError,
} from '../src/errors'

describe('WasiAIError (base)', () => {
  it('is an instance of Error', () => {
    const err = new WasiAIError('base error')
    expect(err).toBeInstanceOf(Error)
  })

  it('has name WasiAIError', () => {
    const err = new WasiAIError('base error')
    expect(err.name).toBe('WasiAIError')
  })

  it('message is set correctly', () => {
    const err = new WasiAIError('something went wrong')
    expect(err.message).toBe('something went wrong')
  })
})

describe('RateLimitError', () => {
  it('extends WasiAIError', () => {
    expect(new RateLimitError()).toBeInstanceOf(WasiAIError)
  })

  it('extends Error', () => {
    expect(new RateLimitError()).toBeInstanceOf(Error)
  })

  it('has name RateLimitError', () => {
    expect(new RateLimitError().name).toBe('RateLimitError')
  })

  it('has a descriptive message', () => {
    expect(new RateLimitError().message.length).toBeGreaterThan(0)
  })
})

describe('InsufficientFundsError', () => {
  it('extends WasiAIError', () => {
    expect(new InsufficientFundsError()).toBeInstanceOf(WasiAIError)
  })

  it('extends Error', () => {
    expect(new InsufficientFundsError()).toBeInstanceOf(Error)
  })

  it('has name InsufficientFundsError', () => {
    expect(new InsufficientFundsError().name).toBe('InsufficientFundsError')
  })

  it('has a descriptive message', () => {
    expect(new InsufficientFundsError().message.length).toBeGreaterThan(0)
  })
})

describe('AgentNotFoundError', () => {
  it('extends WasiAIError', () => {
    expect(new AgentNotFoundError('some-slug')).toBeInstanceOf(WasiAIError)
  })

  it('extends Error', () => {
    expect(new AgentNotFoundError('some-slug')).toBeInstanceOf(Error)
  })

  it('has name AgentNotFoundError', () => {
    expect(new AgentNotFoundError('some-slug').name).toBe('AgentNotFoundError')
  })

  it('includes the slug in message', () => {
    expect(new AgentNotFoundError('text-summarizer').message).toContain('text-summarizer')
  })
})

describe('TimeoutError', () => {
  it('extends WasiAIError', () => {
    expect(new TimeoutError()).toBeInstanceOf(WasiAIError)
  })

  it('extends Error', () => {
    expect(new TimeoutError()).toBeInstanceOf(Error)
  })

  it('has name TimeoutError', () => {
    expect(new TimeoutError().name).toBe('TimeoutError')
  })

  it('has a descriptive message', () => {
    expect(new TimeoutError().message.length).toBeGreaterThan(0)
  })
})
