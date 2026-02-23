/**
 * model.schema.ts — Shared Zod schema for AI model validation
 *
 * A-07: Single source of truth used by both the client-side PublishForm
 *       and the server-side /api/models and /api/v1/agents/register routes.
 *       Prevents client/server schema drift.
 */
import { z } from 'zod'

export const MODEL_CATEGORIES = ['nlp', 'vision', 'audio', 'code', 'multimodal', 'data'] as const
export type ModelCategory = typeof MODEL_CATEGORIES[number]

export const modelCapabilitySchema = z.object({
  name:        z.string().min(1, 'Capability name is required').max(64),
  description: z.string().max(256, 'Description too long'),
  inputType:   z.string().max(32).default('text'),
  outputType:  z.string().max(32).default('text'),
})

export type ModelCapability = z.infer<typeof modelCapabilitySchema>

export const createModelSchema = z.object({
  name: z.string()
    .min(3, 'Name must be at least 3 characters')
    .max(64, 'Name is too long'),

  slug: z.string()
    .min(3, 'Slug must be at least 3 characters')
    .max(64, 'Slug is too long')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens'),

  description: z.string()
    .min(10, 'Please add a description (at least 10 characters)')
    .max(1000, 'Description is too long')
    .optional(),

  category: z.enum(MODEL_CATEGORIES, {
    error: () => ({ message: `Category must be one of: ${MODEL_CATEGORIES.join(', ')}` }),
  }),

  price_per_call: z.number()
    .min(0.01, 'Minimum price is $0.01 USDC')
    .max(100, 'Maximum price is $100 USDC'),

  endpoint_url: z.string().url('Must be a valid HTTPS URL'),

  capabilities: z.array(modelCapabilitySchema).optional().default([]),

  cover_image: z.string().url('Must be a valid URL').optional().nullable(),

  agent_type: z.enum(['model', 'agent', 'workflow']).optional().default('model'),
})

export type CreateModelInput = z.infer<typeof createModelSchema>

// For form state (partial)
export type CreateModelDraft = Partial<CreateModelInput>
