import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EditAgentForm } from './EditAgentForm'

interface EditAgentPageProps {
  params: Promise<{ locale: string; slug: string }>
}

export default async function EditAgentPage({ params }: EditAgentPageProps) {
  const { locale, slug } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  // Fetch agent — must belong to authenticated user
  const { data: agent } = await supabase
    .from('agents')
    .select('*')
    .eq('slug', slug)
    .eq('creator_id', user.id)
    .single()

  if (!agent) notFound()

  return <EditAgentForm agent={agent} locale={locale} />
}
