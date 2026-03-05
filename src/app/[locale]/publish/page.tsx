import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import dynamic from 'next/dynamic'
import { PublishLoading } from './PublishLoading'

// P-06: Dynamic import reduces initial bundle size — i18n-aware loading via PublishLoading
const PublishForm = dynamic(() => import('./PublishForm'), {
  loading: () => <PublishLoading />,
})

interface Props {
  params:       Promise<{ locale: string }>
  searchParams: Promise<{ from?: string }>
}

// UX-01: Auth gate — redirect to login if not authenticated
export default async function PublishPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { from }   = await searchParams
  const supabase   = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${locale}/login?next=/${locale}/publish`)
  }

  // HU-1.2: Detect existing draft from this creator
  const { data: draft } = await supabase
    .from('agents')
    .select('slug, name, description, category, price_per_call, capabilities, endpoint_url, cover_image')
    .eq('creator_id', user.id)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return <PublishForm initialDraft={draft ?? null} from={from} />
}
