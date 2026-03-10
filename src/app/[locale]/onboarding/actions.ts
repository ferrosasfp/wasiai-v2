'use server'

import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Update the onboarding_step for the authenticated creator.
 * Called from wizard steps when progressing or skipping.
 */
export async function setOnboardingStep(step: number): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  await supabase
    .from('creator_profiles')
    .update({ onboarding_step: step })
    .eq('id', user.id)

  const locale = await getLocale()
  redirect(`/${locale}/onboarding`)
}

/**
 * Mark onboarding as completed and redirect to creator dashboard.
 * Called from Step 3 when user clicks "Ir al dashboard" or after wallet setup.
 */
export async function completeOnboarding(): Promise<never> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  await supabase
    .from('creator_profiles')
    .update({ onboarding_completed: true, onboarding_step: 3 })
    .eq('id', user.id)

  const locale = await getLocale()
  redirect(`/${locale}/creator/dashboard`)
}
