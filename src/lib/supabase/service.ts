/**
 * service.ts — Re-export of createServiceClient for service-role-only operations.
 * WAS-71: agent wallets use service role (bypasses RLS).
 */
export { createServiceClient } from '@/lib/supabase/server'
