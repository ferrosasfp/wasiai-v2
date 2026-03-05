import { createClient } from '@/lib/supabase/server'
import { TransparencyDashboard } from './TransparencyDashboard'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata() {
  const t = await getTranslations('transparency')
  return { title: t('title') }
}

export default async function TransparencyPage() {
  const supabase = await createClient()

  const { data: agents } = await supabase
    .from('agents')
    .select('slug, name, price_per_call')
    .eq('registration_type', 'on_chain')
    .order('name')

  return <TransparencyDashboard agents={agents ?? []} />
}
