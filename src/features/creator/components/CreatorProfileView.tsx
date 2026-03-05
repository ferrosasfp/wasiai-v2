import Link from 'next/link'
import Image from 'next/image'
import type { CreatorPublicProfile, CreatorAgentCard } from '../lib/getCreatorByUsername'
import { MessageSquare, Eye, Music, Code2, Bot, BarChart2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

interface Props {
  creator: CreatorPublicProfile
  locale: string
}

const CATEGORY_COLORS: Record<string, string> = {
  nlp:        'bg-blue-100 text-blue-700',
  vision:     'bg-orange-100 text-orange-700',
  audio:      'bg-green-100 text-green-700',
  code:       'bg-orange-100 text-orange-700',
  multimodal: 'bg-yellow-100 text-yellow-700',
  data:       'bg-yellow-100 text-yellow-700',
}

const CATEGORY_ICONS: Record<string, ReactNode> = {
  nlp:        <MessageSquare size={16} />,
  vision:     <Eye           size={16} />,
  audio:      <Music         size={16} />,
  code:       <Code2         size={16} />,
  multimodal: <Bot           size={16} />,
  data:       <BarChart2     size={16} />,
}

export function CreatorProfileView({ creator, locale }: Props) {
  const t = useTranslations('creatorProfile')
  const year = new Date(creator.memberSince).getFullYear()
  const initial = creator.displayName[0]?.toUpperCase() ?? '?'

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-8">

        {/* Back */}
        <Link
          href={`/${locale}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition"
        >
          ← Volver al marketplace
        </Link>

        {/* Creator Header */}
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-gray-100 space-y-4">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#E84142] text-2xl font-bold text-white">
              {initial}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-gray-900 truncate">{creator.displayName}</h1>
              <p className="text-sm text-gray-500">@{creator.username}</p>
            </div>
          </div>

          {/* Bio */}
          {creator.bio && (
            <p className="text-sm text-gray-600 leading-relaxed">{creator.bio}</p>
          )}

          {/* Stats pills */}
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              {creator.agentCount} {creator.agentCount === 1 ? 'agente' : 'agentes'}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              {creator.totalCalls.toLocaleString()} llamadas
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              Desde {year}
            </span>
          </div>
        </div>

        {/* Agents Grid */}
        <section>
          <h2 className="mb-4 font-semibold text-gray-900">{t('publishedAgents')}</h2>

          {creator.agents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-white py-12 text-center shadow-sm">
              <p className="text-gray-500 text-sm">{t('noAgents')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {creator.agents.map((agent, index) => (
                <AgentCardPublic key={agent.id} agent={agent} locale={locale} index={index} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function AgentCardPublic({
  agent, locale, index,
}: {
  agent: CreatorAgentCard
  locale: string
  index: number
}) {
  return (
    <Link
      href={`/${locale}/models/${agent.slug}`}
      className="group block rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:shadow-md hover:-translate-y-0.5"
    >
      <div className="flex items-start gap-3">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#E84142] to-[#c73535] text-lg overflow-hidden">
          {agent.cover_image ? (
            <Image
              src={agent.cover_image}
              alt={`${agent.name} cover`}
              fill
              className="object-cover"
              sizes="40px"
              priority={index < 3}
            />
          ) : (
            CATEGORY_ICONS[agent.category] ?? <Bot size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 group-hover:text-[#E84142] transition-colors truncate">
            {agent.name}
          </h3>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CATEGORY_COLORS[agent.category] ?? 'bg-gray-100 text-gray-600'}`}>
              {agent.category}
            </span>
          </div>
        </div>
      </div>

      {agent.description && (
        <p className="mt-3 text-xs text-gray-500 line-clamp-2 leading-relaxed">
          {agent.description}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        <span>${agent.price_per_call.toFixed(3)}/call</span>
        <span>{agent.total_calls.toLocaleString()} llamadas</span>
      </div>
    </Link>
  )
}
