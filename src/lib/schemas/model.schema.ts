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

  // HU-1.2: slug is auto-generated server-side if not provided
  slug: z.string()
    .min(3, 'Slug must be at least 3 characters')
    .max(64, 'Slug is too long')
    .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens')
    .optional(),

  description: z.string()
    .min(10, 'Please add a description (at least 10 characters)')
    .max(1000, 'Description is too long')
    .optional(),

  category: z.enum(MODEL_CATEGORIES, {
    error: () => ({ message: `Category must be one of: ${MODEL_CATEGORIES.join(', ')}` }),
  }),

  // HU-1.2: price_per_call is optional for drafts (filled in step 2)
  price_per_call: z.number()
    .min(0.01, 'Minimum price is $0.01 USDC')
    .max(100, 'Maximum price is $100 USDC')
    .optional(),

  // HU-1.2: endpoint_url is optional for drafts (filled in step 3)
  endpoint_url: z.string().url('Must be a valid HTTPS URL').optional(),

  capabilities: z.array(modelCapabilitySchema).optional().default([]),

  cover_image: z.string().url('Must be a valid URL').optional().nullable(),

  agent_type: z.enum(['model', 'agent', 'workflow']).optional().default('model'),

  // HU-1.2: status field for draft support
  status: z.enum(['draft', 'active']).optional().default('active'),

  // HU-3.3: free trial fields
  free_trial_enabled: z.boolean().optional().default(false),
  free_trial_limit: z.number().int().min(1).max(10).optional().default(1),

  // HU-8.4: Creator-configurable rate limits
  max_rpm: z.number().int().min(1).max(600).optional().default(60),
  max_rpd: z.number().int().min(1).max(100000).optional().default(1000),
})

export type CreateModelInput = z.infer<typeof createModelSchema>

// For form state (partial) — HU-1.2: explicit draft type for multi-step form
export type CreateModelDraft = Partial<CreateModelInput>
