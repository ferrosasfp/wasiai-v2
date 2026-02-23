import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PublishForm from './PublishForm'

interface Props {
  params: Promise<{ locale: string }>
}

// UX-01: Auth gate — redirect to login if not authenticated
// Wallet gate — wallet required before publishing
export default async function PublishPage({ params }: Props) {
  const { locale } = await params
  const supabase = await createClient()
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

  return <PublishForm initialWallet={profile?.wallet_address ?? null} />
}
