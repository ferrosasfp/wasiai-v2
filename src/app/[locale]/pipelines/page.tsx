/**
 * /[locale]/pipelines — UI Visual de Pipelines
 * WAS-38: Pipeline Builder + Status + History
 * Server Component: carga agents + user, luego delega a cliente
 */

import { createClient }        from '@/lib/supabase/server'
import { getTranslations }     from 'next-intl/server'
// createServiceClient removido — NG-013
import { PipelinePageClient }  from './_components/PipelinePageClient'

interface Props {
  params: Promise<{ locale: string }>
}

interface AgentRow {
  slug:           string
  name:           string
  price_per_call: number
}

export default async function PipelinesPage({ params }: Props) {
  await params // consume params (locale not needed for data fetch)

  // NG-013: createClient() respeta RLS — no usar createServiceClient en Server Components
  const t        = await getTranslations('pipelines')
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  // Cargar agentes activos
  const { data: agentsData } = await supabase
    .from('agents')
    .select('slug, name, price_per_call')
    .eq('status', 'active')
    .order('name', { ascending: true })

  const availableAgents: AgentRow[] = (agentsData ?? []) as AgentRow[]

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">{t('title')}</h1>
        <p className="text-gray-500 text-sm mt-1">{t('subtitle')}</p>
      </div>

      <PipelinePageClient
        availableAgents={availableAgents}
        userId={user?.id ?? ''}
      />
    </main>
  )
}
