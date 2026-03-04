'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Zap, Search, Rocket } from 'lucide-react'

interface HeroDualCardProps {
  locale: string
  headline: string
  subtitleCreator: string
  subtitleConsumer: string
  ctaCreator: string
  ctaConsumer: string
  tagline: string
  tabCreator: string
  tabConsumer: string
  badge: string
  tabLabel: string
}

export function HeroDualCard({
  locale,
  headline,
  subtitleCreator,
  subtitleConsumer,
  ctaCreator,
  ctaConsumer,
  tagline,
  tabCreator,
  tabConsumer,
  badge,
  tabLabel,
}: HeroDualCardProps) {
  // Consumer activo por defecto
  const [active, setActive] = useState<'consumer' | 'creator'>('consumer')

  const isConsumer = active === 'consumer'
  const isCreator  = active === 'creator'

  return (
    <div className="mx-auto max-w-4xl text-center">

      {/* Badge */}
      <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-avax-50 border border-avax-100 px-4 py-1.5 text-sm text-avax-600 font-medium">
        <Zap size={14} />
        <span>{badge}</span>
      </div>

      {/* Headline — responsive typography */}
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-8">
        {headline}
      </h1>

      {/* Tab toggle — ARIA tablist */}
      <div
        role="tablist"
        aria-label={tabLabel}
        className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 mb-8"
      >
        <button
          role="tab"
          aria-selected={isConsumer}
          aria-controls="panel-consumer"
          onClick={() => setActive('consumer')}
          className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
            isConsumer
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tabConsumer}
        </button>
        <button
          role="tab"
          aria-selected={isCreator}
          aria-controls="panel-creator"
          onClick={() => setActive('creator')}
          className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
            isCreator
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tabCreator}
        </button>
      </div>

      {/* Cards — desktop side-by-side, mobile stacked */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">

        {/* Consumer card */}
        <div
          id="panel-consumer"
          role="tabpanel"
          tabIndex={0}
          className={`rounded-2xl border-2 p-6 text-left transition-all cursor-pointer ${
            isConsumer
              ? 'border-avax-400 bg-avax-50 shadow-md'
              : 'border-gray-200 bg-white opacity-60 hover:opacity-80'
          }`}
          onClick={() => setActive('consumer')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setActive('consumer')
          }}
        >
          <div className="mb-3 flex justify-center"><Search size={28} className="text-avax-500" /></div>
          <p className="text-base font-medium text-gray-800 mb-4 leading-relaxed">
            {subtitleConsumer}
          </p>
          <a
            href={`/${locale}#agents`}
            onClick={(e) => {
              e.stopPropagation()
              // Si ya estamos en home → scroll suave (no navegación)
              const isHome =
                window.location.pathname === `/${locale}` ||
                window.location.pathname === `/${locale}/`
              if (isHome) {
                e.preventDefault()
                document.getElementById('agents')?.scrollIntoView({ behavior: 'smooth' })
              }
              // Si no es home → href="/${locale}#agents" navega normalmente al anchor
            }}
            className={`inline-flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm ${
              isConsumer
                ? 'bg-avax-500 text-white hover:bg-avax-600'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {ctaConsumer} →
          </a>
        </div>

        {/* Creator card */}
        <div
          id="panel-creator"
          role="tabpanel"
          tabIndex={0}
          className={`rounded-2xl border-2 p-6 text-left transition-all cursor-pointer ${
            isCreator
              ? 'border-avax-400 bg-avax-50 shadow-md'
              : 'border-gray-200 bg-white opacity-60 hover:opacity-80'
          }`}
          onClick={() => setActive('creator')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') setActive('creator')
          }}
        >
          <div className="mb-3 flex justify-center"><Rocket size={28} className="text-avax-500" /></div>
          <p className="text-base font-medium text-gray-800 mb-4 leading-relaxed">
            {subtitleCreator}
          </p>
          <Link
            href={`/${locale}/publish`}
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-2 font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm ${
              isCreator
                ? 'bg-avax-500 text-white hover:bg-avax-600'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {ctaCreator} →
          </Link>
        </div>

      </div>

      {/* Tagline */}
      <p className="text-sm text-gray-400 font-medium">{tagline}</p>

    </div>
  )
}
