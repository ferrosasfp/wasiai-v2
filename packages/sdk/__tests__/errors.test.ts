import { describe, expect, it } from 'vitest'
import {
  AgentNotFoundError,
  InsufficientBudgetError,
  RateLimitError,
  WasiAIError,
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

  it('statusCode is set when provided', () => {
    const err = new WasiAIError('bad', 500)
    expect(err.statusCode).toBe(500)
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

  it('has statusCode 429', () => {
    expect(new RateLimitError().statusCode).toBe(429)
  })

  it('has a descriptive message', () => {
    expect(new RateLimitError().message.length).toBeGreaterThan(0)
  })
})

describe('InsufficientBudgetError', () => {
  it('extends WasiAIError', () => {
    expect(new InsufficientBudgetError()).toBeInstanceOf(WasiAIError)
  })

  it('extends Error', () => {
    expect(new InsufficientBudgetError()).toBeInstanceOf(Error)
  })

  it('has name InsufficientBudgetError', () => {
    expect(new InsufficientBudgetError().name).toBe('InsufficientBudgetError')
  })

  it('has statusCode 402', () => {
    expect(new InsufficientBudgetError().statusCode).toBe(402)
  })

  it('has a descriptive message', () => {
    expect(new InsufficientBudgetError().message.length).toBeGreaterThan(0)
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

  it('has statusCode 404', () => {
    expect(new AgentNotFoundError('some-slug').statusCode).toBe(404)
  })

  it('includes the slug in message', () => {
    expect(new AgentNotFoundError('text-summarizer').message).toContain('text-summarizer')
  })
})
