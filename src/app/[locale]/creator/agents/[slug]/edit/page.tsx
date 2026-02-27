import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { EditAgentForm } from './EditAgentForm'
import { AgentExamples } from '@/features/creator/components/AgentExamples'

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

  return (
    <div className="space-y-8">
      <EditAgentForm agent={agent} locale={locale} />
      {/* HU-4.3: Sección de ejemplos Input/Output curados */}
      <div className="mx-auto max-w-2xl px-4">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
          <AgentExamples agentId={agent.id} />
        </div>
      </div>
    </div>
  )
}
