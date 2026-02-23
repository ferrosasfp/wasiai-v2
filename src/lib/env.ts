/**
 * env.ts — Centralized, type-safe environment variable validation
 *
 * All process.env accesses should go through this module.
 * Fails fast at startup if required variables are missing.
 *
 * T-03: Replaces scattered process.env.VAR! non-null assertions.
 */
import { z } from 'zod'

// ── Schema ────────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Supabase (required)
  NEXT_PUBLIC_SUPABASE_URL:       z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY:  z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY:      z.string().min(1).optional(),

  // Chain / blockchain (required)
  NEXT_PUBLIC_CHAIN_ID:                      z.coerce.number().default(43113),
  NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS:  z.string().optional(),
  MARKETPLACE_CONTRACT_ADDRESS:              z.string().optional(),
  NEXT_PUBLIC_MARKETPLACE_ADDRESS_FUJI:      z.string().optional(),
  NEXT_PUBLIC_MARKETPLACE_ADDRESS_MAINNET:   z.string().optional(),
  NEXT_PUBLIC_WASIAI_TREASURY:               z.string().optional(),
  WASIAI_TREASURY_ADDRESS:                   z.string().optional(),
  OPERATOR_PRIVATE_KEY:                      z.string().optional(),

  // RPC
  NEXT_PUBLIC_RPC_TESTNET:  z.string().url().optional(),
  NEXT_PUBLIC_RPC_MAINNET:  z.string().url().optional(),
  NEXT_PUBLIC_BUNDLER_URL:  z.string().url().optional(),
  NEXT_PUBLIC_PAYMASTER_URL: z.string().url().optional(),

  // Site
  NEXT_PUBLIC_SITE_URL:  z.string().url().optional(),

  // Storage
  PINATA_JWT:              z.string().optional(),
  NEXT_PUBLIC_STORAGE_GATEWAY: z.string().url().optional(),
  STORAGE_PROVIDER:        z.enum(['pinata', 'local']).optional(),

  // Rate limiting (Upstash)
  UPSTASH_REDIS_REST_URL:   z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // AI / Upstream
  GROQ_API_KEY:  z.string().optional(),

  // Auth
  OPEN_REGISTRATION_KEY: z.string().optional(),
  WASIAI_SYSTEM_CREATOR_ID: z.string().optional(), // UUID-like but not strictly validated

  // Runtime
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

// ── Parse + export ────────────────────────────────────────────────────────────

function createEnv() {
  const parsed = envSchema.safeParse(process.env)

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:')
    console.error(parsed.error.flatten().fieldErrors)
    throw new Error('Invalid environment configuration — check your .env file')
  }

  return parsed.data
}

// Singleton: parsed once at module load time.
// During Next.js static build phase, env vars may not be injected yet
// (especially in Vercel preview environments). We defer validation to
// runtime so static page generation doesn't break the deploy.
// At runtime (real requests), Vercel always injects env vars.
const isBuildPhase =
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.NEXT_PHASE === 'phase-export'

function createEnvSafe() {
  if (isBuildPhase) {
    // Skip strict validation at build time — env vars are injected at runtime
    return process.env as unknown as z.infer<typeof envSchema>
  }
  return createEnv()
}

export const env = createEnvSafe()

// ── Convenience re-exports ────────────────────────────────────────────────────

export const isDev  = env.NODE_ENV === 'development'
export const isProd = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
