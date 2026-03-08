'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Zap } from 'lucide-react'

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
  const [active, setActive] = useState<'consumer' | 'creator'>('consumer')

  const isConsumer = active === 'consumer'

  return (
    <div className="mx-auto max-w-3xl text-center">

      {/* Badge */}
      <div className="mb-4 sm:mb-6 inline-flex items-center gap-2 rounded-full bg-avax-50 border border-avax-100 px-4 py-1.5 text-sm text-avax-600 font-medium">
        <Zap size={14} />
        <span>{badge}</span>
      </div>

      {/* Headline */}
      <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-4 sm:mb-6">
        {headline}
      </h1>

      {/* Tab toggle */}
      <div
        role="tablist"
        aria-label={tabLabel}
        className="inline-flex rounded-xl border border-gray-200 bg-gray-100 p-1 mb-5 sm:mb-8"
      >
        <button
          role="tab"
          aria-selected={isConsumer}
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
          aria-selected={!isConsumer}
          onClick={() => setActive('creator')}
          className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
            !isConsumer
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tabCreator}
        </button>
      </div>

      {/* Dynamic subtitle */}
      <p className="text-base sm:text-lg text-gray-600 max-w-xl mx-auto mb-6 sm:mb-8 leading-relaxed transition-all">
        {isConsumer ? subtitleConsumer : subtitleCreator}
      </p>

      {/* Dynamic CTA */}
      <div className="flex justify-center gap-4">
        {isConsumer ? (
          <a
            href={`/${locale}#agents`}
            onClick={(e) => {
              const isHome =
                window.location.pathname === `/${locale}` ||
                window.location.pathname === `/${locale}/`
              if (isHome) {
                e.preventDefault()
                document.getElementById('agents')?.scrollIntoView({ behavior: 'smooth' })
              }
            }}
            className="inline-flex items-center gap-2 rounded-full bg-avax-500 px-8 py-3 font-semibold text-white hover:bg-avax-600 transition-colors text-sm shadow-sm"
          >
            {ctaConsumer} →
          </a>
        ) : (
          <Link
            href={`/${locale}/publish`}
            className="inline-flex items-center gap-2 rounded-full bg-avax-500 px-8 py-3 font-semibold text-white hover:bg-avax-600 transition-colors text-sm shadow-sm"
          >
            {ctaCreator} →
          </Link>
        )}
      </div>

      {/* Tagline */}
      <p className="mt-4 sm:mt-8 text-xs sm:text-sm text-gray-400 font-medium">{tagline}</p>

    </div>
  )
}
