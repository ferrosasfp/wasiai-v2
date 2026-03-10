import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Ensures a creator_profile exists for the given user.
 * Fallback for cases where the DB trigger `handle_new_user` didn't fire
 * (e.g., certain OAuth providers, edge cases).
 *
 * Safe to call multiple times — uses ON CONFLICT DO NOTHING.
 */
export async function ensureCreatorProfile(
  supabase: SupabaseClient,
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> },
): Promise<void> {
  // Quick check — avoid unnecessary insert attempts
  const { data: existing } = await supabase
    .from('creator_profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (existing) return

  // Build username from email
  const email = user.email ?? ''
  let username = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (!username) username = `user_${user.id.slice(0, 8)}`

  // Ensure uniqueness
  const { data: taken } = await supabase
    .from('creator_profiles')
    .select('username')
    .eq('username', username)
    .maybeSingle()

  if (taken) {
    username = `${username}_${Date.now().toString(36)}`
  }

  const displayName =
    (user.user_metadata?.full_name as string) ??
    (user.user_metadata?.name as string) ??
    email.split('@')[0]

  const avatarUrl = (user.user_metadata?.avatar_url as string) ?? null

  await supabase.from('creator_profiles').upsert(
    {
      id: user.id,
      username,
      display_name: displayName,
      avatar_url: avatarUrl,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  )
}
