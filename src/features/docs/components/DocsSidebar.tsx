'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

const SECTION_KEYS = [
  { id: 'quickstart',    key: 'quickstart'  },
  { id: 'sdk-node',      key: 'sdkNode'     },
  { id: 'sdk-python',    key: 'sdkPython'   },
  { id: 'api-reference',   key: 'apiRef'         },
  { id: 'mcp-integration', key: 'mcpIntegration' },
  { id: 'errors',          key: 'errors'         },
  { id: 'x402',          key: 'x402'         },
  { id: 'compose',       key: 'compose'      },
  { id: 'agent-keys',    key: 'agentKeys'    },
  { id: 'creator-guide', key: 'creatorGuide' },
  { id: 'agentkit',      key: 'agentkit'     },
  { id: 'pricing',       key: 'pricing'      },
] as const

interface NavListProps {
  active: string
  onNav: (id: string) => void
}

function NavList({ active, onNav }: NavListProps) {
  const t = useTranslations('docs')
  return (
    <nav className="space-y-1">
      <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
        {t('contents')}
      </p>
      {SECTION_KEYS.map(({ id, key }) => (
        <button
          key={id}
          onClick={() => onNav(id)}
          className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
            active === id
              ? 'bg-avax-50 text-avax-600 font-semibold'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          }`}
        >
          {t(key)}
        </button>
      ))}
    </nav>
  )
}

export function DocsSidebar() {
  const t = useTranslations('docs')
  const [active, setActive] = useState('quickstart')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Scroll spy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActive(entry.target.id)
          }
        }
      },
      { rootMargin: '0px 0px -60% 0px', threshold: 0.1 },
    )
    SECTION_KEYS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  function handleNavClick(id: string) {
    setActive(id)
    setDrawerOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  const activeLabel = SECTION_KEYS.find((s) => s.id === active)

  return (
    <>
      {/* Mobile toggle button */}
      <div className="lg:hidden sticky top-14 z-40 bg-white border-b border-gray-100 px-4 py-2">
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="flex items-center gap-2 text-sm font-medium text-gray-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {drawerOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
          {activeLabel ? t(activeLabel.key) : t('contents')}
        </button>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-30 flex">
          <div
            role="presentation"
            className="fixed inset-0 bg-black/30"
            onClick={() => setDrawerOpen(false)}
            onKeyDown={(e) => e.key === 'Escape' && setDrawerOpen(false)}
          />
          <div className="relative w-64 bg-white p-4 shadow-xl">
            <NavList active={active} onNav={handleNavClick} />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className="hidden lg:block w-56 shrink-0">
        <div className="sticky top-20">
          <NavList active={active} onNav={handleNavClick} />
        </div>
      </div>
    </>
  )
}
