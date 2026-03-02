// src/lib/webhooks/events.ts
export const WEBHOOK_EVENTS = ['agent.invoked', 'agent.error', 'credits.low'] as const
export type WebhookEvent = typeof WEBHOOK_EVENTS[number]
