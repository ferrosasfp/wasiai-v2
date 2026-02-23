/**
 * api.schemas.ts — Shared Zod schemas for API request validation
 *
 * S-03: Centralized input validation to prevent injection and ensure
 *        consistent error handling across all API routes.
 */
import { z } from 'zod'

// ── Pagination ────────────────────────────────────────────────────────────────

export const paginationSchema = z.object({
  limit:  z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  q:      z.string().max(100).optional(),
})

export type PaginationInput = z.infer<typeof paginationSchema>

// ── MCP ───────────────────────────────────────────────────────────────────────

export const mcpRequestSchema = z.object({
  method: z.string().min(1).max(64),
  params: z.object({
    name:      z.string().max(128).optional(),
    arguments: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
})

export type McpRequest = z.infer<typeof mcpRequestSchema>

// ── Model creation (shared between PublishForm and register route) ─────────────
// NOTE: This is a base schema. A-07 creates the full model.schema.ts in Phase 3.

export const modelCategorySchema = z.enum(['nlp', 'vision', 'audio', 'code', 'multimodal', 'data'])

export const modelCapabilitySchema = z.object({
  name:        z.string().min(1).max(64),
  description: z.string().max(256),
  inputType:   z.string().max(32),
  outputType:  z.string().max(32),
})

// ── Agent key ─────────────────────────────────────────────────────────────────

export const createAgentKeySchema = z.object({
  name:        z.string().min(1).max(64),
  budget_usdc: z.number().min(1).max(1000).default(10),
})

export type CreateAgentKeyInput = z.infer<typeof createAgentKeySchema>
