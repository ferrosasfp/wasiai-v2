import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { getModelBySlug } from '@/features/models/services/models.service'
import Link from 'next/link'

interface Props {
  params: Promise<{ locale: string; slug: string }>
}

export default async function ModelDetailPage({ params }: Props) {
  const { locale, slug } = await params
  setRequestLocale(locale)

  const model = await getModelBySlug(slug)
  if (!model) notFound()

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-6 py-12">
        {/* Back */}
        <Link href={`/${locale}`} className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          ← Back to marketplace
        </Link>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Main */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
              <div className="flex items-start gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-2xl shrink-0">
                  🤖
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h1 className="text-2xl font-bold text-gray-900">{model.name}</h1>
                    {model.is_featured && (
                      <span className="rounded-full bg-indigo-50 px-3 py-0.5 text-xs font-semibold text-indigo-600">Featured</span>
                    )}
                    <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs font-medium text-gray-600 capitalize">{model.category}</span>
                  </div>
                  {model.creator && (
                    <p className="mt-1 text-sm text-gray-500">
                      by <span className="font-medium text-gray-700">@{model.creator.username}</span>
                      {model.creator.verified && <span className="ml-1 text-indigo-500">✓</span>}
                    </p>
                  )}
                </div>
              </div>
              {model.description && (
                <p className="mt-4 text-gray-600 leading-relaxed">{model.description}</p>
              )}
            </div>

            {/* Capabilities */}
            {model.capabilities && model.capabilities.length > 0 && (
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
                <h2 className="mb-4 font-semibold text-gray-900">Capabilities</h2>
                <div className="space-y-3">
                  {model.capabilities.map((cap, i) => (
                    <div key={i} className="rounded-xl bg-gray-50 p-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{cap.name}</span>
                        <span className="text-xs text-gray-400">{cap.inputType} → {cap.outputType}</span>
                      </div>
                      {cap.description && <p className="mt-1 text-sm text-gray-500">{cap.description}</p>}
                      {cap.example && (
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded-lg bg-gray-100 p-2">
                            <p className="font-medium text-gray-500 mb-1">Input</p>
                            <p className="text-gray-700 font-mono">{cap.example.input}</p>
                          </div>
                          <div className="rounded-lg bg-indigo-50 p-2">
                            <p className="font-medium text-indigo-500 mb-1">Output</p>
                            <p className="text-indigo-700 font-mono">{cap.example.output}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agent API */}
            <div className="rounded-2xl bg-gray-900 p-6 text-white">
              <h2 className="mb-3 font-semibold">🤖 Call via Agent API</h2>
              <pre className="overflow-auto rounded-lg bg-gray-800 p-4 text-sm text-green-400">{`POST /api/v1/models/${model.slug}/invoke
x-payment: <x402-usdc-payment>
Content-Type: application/json

{
  "input": "your input here"
}`}</pre>
              <p className="mt-3 text-xs text-gray-400">
                Any AI agent can call this model autonomously using x402 payments on Avalanche.
              </p>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Pricing */}
            <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100">
              <div className="text-center">
                <p className="text-4xl font-extrabold text-gray-900">${model.price_per_call}</p>
                <p className="text-sm text-gray-500">per call · {model.currency}</p>
              </div>
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <div className="flex justify-between">
                  <span>Chain</span>
                  <span className="font-medium capitalize">{model.chain}</span>
                </div>
                <div className="flex justify-between">
                  <span>Total calls</span>
                  <span className="font-medium">{model.total_calls.toLocaleString()}</span>
                </div>
              </div>
              <button className="mt-5 w-full rounded-xl bg-indigo-600 py-3 font-semibold text-white hover:bg-indigo-700 transition">
                Connect Wallet & Call
              </button>
              <p className="mt-2 text-center text-xs text-gray-400">Powered by x402 · Avalanche</p>
            </div>

            {/* Creator */}
            {model.creator && (
              <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100">
                <h3 className="mb-3 text-sm font-semibold text-gray-500 uppercase tracking-wide">Creator</h3>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-600">
                    {model.creator.display_name?.[0] ?? model.creator.username[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-gray-800">
                      {model.creator.display_name ?? model.creator.username}
                      {model.creator.verified && <span className="ml-1 text-indigo-500">✓</span>}
                    </p>
                    <p className="text-xs text-gray-500">@{model.creator.username}</p>
                  </div>
                </div>
                {model.creator.bio && (
                  <p className="mt-3 text-sm text-gray-600">{model.creator.bio}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
