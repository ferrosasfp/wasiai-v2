import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ensureCreatorProfile } from '@/lib/ensureCreatorProfile'
import { setOnboardingStep } from './actions'
import { OnboardingStep1 } from '@/components/onboarding/OnboardingStep1'
import { OnboardingStep2 } from '@/components/onboarding/OnboardingStep2'
import { OnboardingStep3 } from '@/components/onboarding/OnboardingStep3'

interface Props {
  params:       Promise<{ locale: string }>
  searchParams: Promise<{ published?: string }>
}

export default async function OnboardingPage({ params, searchParams }: Props) {
  const { locale }     = await params
  const { published }  = await searchParams

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  // HU-069: Ensure creator_profile exists (fallback for missing DB trigger)
  await ensureCreatorProfile(supabase, user)

  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('onboarding_completed, onboarding_step, display_name, bio, wallet_address')
    .eq('id', user.id)
    .single()

  // Already completed → go to dashboard
  if (profile?.onboarding_completed) {
    redirect(`/${locale}/creator/dashboard`)
  }

  let step = profile?.onboarding_step ?? 1

  // ?published=true signals the user just completed Step 2 (publish)
  // Advance to Step 3 server-side before rendering
  if (published === 'true' && step < 3) {
    await setOnboardingStep(3)
    step = 3
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-12">
      <div className="w-full max-w-lg">
        {/* Progress indicator */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {[1, 2, 3].map(n => (
            <div key={n} className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                n <= step
                  ? 'bg-avax-500 text-white'
                  : 'bg-gray-200 text-gray-500'
              }`}>
                {n}
              </div>
              {n < 3 && (
                <div className={`h-0.5 w-12 transition-colors ${
                  n < step ? 'bg-avax-500' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>

        {step === 1 && (
          <OnboardingStep1
            displayName={profile?.display_name ?? ''}
            bio={profile?.bio ?? ''}
          />
        )}
        {step === 2 && (
          <OnboardingStep2 locale={locale} />
        )}
        {step === 3 && (
          <OnboardingStep3
            initialWallet={profile?.wallet_address ?? null}
          />
        )}
      </div>
    </main>
  )
}
