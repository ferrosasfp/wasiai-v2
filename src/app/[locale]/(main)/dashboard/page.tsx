import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

interface Props {
  params: Promise<{ locale: string }>
}

export default async function DashboardPage({ params }: Props) {
  const { locale } = await params
  setRequestLocale(locale)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  // Get creator profile + models
  const [profileResult, modelsResult, callsResult] = await Promise.all([
    supabase.from('creator_profiles').select('*').eq('id', user.id).single(),
    supabase.from('agents').select('*').eq('creator_id', user.id).order('created_at', { ascending: false }),
    supabase.from('agent_calls')
      .select('amount_paid, called_at, status, model_id, caller_type')
      .in('model_id',
        (await supabase.from('agents').select('id').eq('creator_id', user.id)).data?.map(m => m.id) ?? []
      )
      .order('called_at', { ascending: false })
      .limit(10),
  ])

  const profile = profileResult.data
  const models = modelsResult.data ?? []
  const recentCalls = callsResult.data ?? []

  const totalEarnings = models.reduce((sum, m) => sum + Number(m.total_revenue) * 0.8, 0)
  const totalCalls = models.reduce((sum, m) => sum + m.total_calls, 0)
  const activeModels = models.filter(m => m.status === 'active').length

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Hey, {profile?.display_name ?? user.email?.split('@')[0]} 👋
            </h1>
            <p className="text-sm text-gray-500">@{profile?.username}</p>
          </div>
          <Link
            href={`/${locale}/publish`}
            className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 transition"
          >
            + Publish Model
          </Link>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: 'Total Earnings', value: `$${totalEarnings.toFixed(2)}`, icon: '💰', color: 'text-green-600' },
            { label: 'Total Calls', value: totalCalls.toLocaleString(), icon: '⚡', color: 'text-indigo-600' },
            { label: 'Active Models', value: activeModels, icon: '🤖', color: 'text-purple-600' },
            { label: 'All Models', value: models.length, icon: '📦', color: 'text-gray-600' },
          ].map(stat => (
            <div key={stat.label} className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
              <div className="text-2xl mb-1">{stat.icon}</div>
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* My Models */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <h2 className="font-semibold text-gray-900">My Models</h2>
                <Link href={`/${locale}/publish`} className="text-sm text-indigo-600 hover:underline">+ New</Link>
              </div>
              {models.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="text-4xl mb-3">🤖</div>
                  <p className="text-gray-500 text-sm">No models yet</p>
                  <Link
                    href={`/${locale}/publish`}
                    className="mt-4 inline-block rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                  >
                    Publish your first model
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {models.map(model => (
                    <div key={model.id} className="flex items-center gap-4 px-6 py-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-lg shrink-0">🤖</div>
                      <div className="flex-1 min-w-0">
                        <Link
                          href={`/${locale}/models/${model.slug}`}
                          className="font-medium text-gray-900 hover:text-indigo-600 truncate block"
                        >
                          {model.name}
                        </Link>
                        <p className="text-xs text-gray-400">{model.total_calls} calls · ${(Number(model.total_revenue) * 0.8).toFixed(2)} earned</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        model.status === 'active' ? 'bg-green-100 text-green-700' :
                        model.status === 'paused' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {model.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Calls */}
          <div>
            <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
              <div className="border-b border-gray-100 px-6 py-4">
                <h2 className="font-semibold text-gray-900">Recent Calls</h2>
              </div>
              {recentCalls.length === 0 ? (
                <div className="py-10 text-center text-sm text-gray-400">No calls yet</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {recentCalls.map(call => (
                    <div key={`${call.model_id}-${call.called_at}`} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <span className={`inline-block rounded-full w-2 h-2 mr-2 ${call.status === 'success' ? 'bg-green-400' : 'bg-red-400'}`} />
                        <span className="text-xs text-gray-500">{call.caller_type ?? 'human'}</span>
                      </div>
                      <span className="text-xs font-medium text-gray-700">+${(Number(call.amount_paid) * 0.8).toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
