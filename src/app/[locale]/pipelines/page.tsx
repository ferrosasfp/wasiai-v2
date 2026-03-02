/**
 * /[locale]/pipelines — UI Visual de Pipelines
 * WAS-38: Pipeline Builder + Status + History
 * Server Component: carga agents + user, luego delega a cliente
 */

import { createClient }        from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/server'
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

  // Auth-aware client — RLS applies
  const supabase        = await createClient()
  const serviceSupabase = createServiceClient()

  const { data: { user } } = await supabase.auth.getUser()

  // Cargar agentes activos
  const { data: agentsData } = await serviceSupabase
    .from('agents')
    .select('slug, name, price_per_call')
    .eq('status', 'active')
    .order('name', { ascending: true })

  const availableAgents: AgentRow[] = (agentsData ?? []) as AgentRow[]

  return (
    <main className="max-w-3xl mx-auto px-4 py-10 space-y-10">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Pipeline Builder</h1>
        <p className="text-gray-500 text-sm mt-1">
          Encadena agentes en pasos para crear flujos multi-step sin código.
        </p>
      </div>

      <PipelinePageClient
        availableAgents={availableAgents}
        userId={user?.id ?? ''}
      />
    </main>
  )
}
