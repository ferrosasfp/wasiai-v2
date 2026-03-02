// src/lib/webhooks/events.ts
export const WEBHOOK_EVENTS = [
  'agent.invoked',
  'agent.error',
  'credits.low',
  'job.completed',
  'job.failed',
] as const
export type WebhookEvent = typeof WEBHOOK_EVENTS[number]
