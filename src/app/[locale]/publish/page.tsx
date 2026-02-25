import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import dynamic from 'next/dynamic'

// P-06: Dynamic import reduces initial bundle by ~50KB+ (form includes heavy Web3 deps)
const PublishForm = dynamic(() => import('./PublishForm'), {
  loading: () => (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-avax-600 border-t-transparent" />
        <p className="text-sm text-gray-500">Loading editor...</p>
      </div>
    </div>
  ),
})

interface Props {
  params:       Promise<{ locale: string }>
  searchParams: Promise<{ from?: string }>
}

// UX-01: Auth gate — redirect to login if not authenticated
// Wallet gate — wallet required before publishing
export default async function PublishPage({ params, searchParams }: Props) {
  const { locale }   = await params
  const { from }     = await searchParams
  const supabase     = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${locale}/login?next=/${locale}/publish`)
  }

  // Fetch wallet address — required to receive earnings
  const { data: profile } = await supabase
    .from('creator_profiles')
    .select('wallet_address')
    .eq('id', user.id)
    .single()

  return <PublishForm initialWallet={profile?.wallet_address ?? null} from={from} />
}
