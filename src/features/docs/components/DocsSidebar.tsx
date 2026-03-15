'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

const NAV_GROUPS = [
  {
    groupKey: 'gettingStarted',
    items: [
      { id: 'quickstart',    key: 'quickstart'  },
      { id: 'agent-keys',    key: 'agentKeys'   },
      { id: 'pricing',       key: 'pricing'     },
    ],
  },
  {
    groupKey: 'invoking',
    items: [
      { id: 'api-reference',    key: 'apiRef'        },
      { id: 'sdk-node',         key: 'sdkNode'       },
      { id: 'sdk-python',       key: 'sdkPython'     },
      { id: 'mcp-integration',  key: 'mcpIntegration'},
    ],
  },
  {
    groupKey: 'discovery',
    items: [
      { id: 'discovery',     key: 'discovery'   },
    ],
  },
  {
    groupKey: 'advanced',
    items: [
      { id: 'compose',       key: 'compose'     },
      { id: 'x402',          key: 'x402'        },
    ],
  },
  {
    groupKey: 'forCreators',
    items: [
      { id: 'agent-registration', key: 'agentRegistration' },
      { id: 'creator-guide', key: 'creatorGuide'},
      { id: 'agentkit',      key: 'agentkit'    },
      { id: 'creator-cli',   key: 'creatorCli'  },
    ],
  },
  {
    groupKey: 'reference',
    items: [
      { id: 'errors',        key: 'errors'      },
      { id: 'collections',   key: 'collections' },
    ],
  },
]

const SECTION_KEYS = NAV_GROUPS.flatMap(g => g.items)

interface NavListProps {
  active: string
  onNav: (id: string) => void
}

function NavList({ active, onNav }: NavListProps) {
  const t = useTranslations('docs')
  return (
    <nav className="space-y-4">
      {NAV_GROUPS.map(group => (
        <div key={group.groupKey}>
          <p className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            {t(group.groupKey)}
          </p>
          <div className="space-y-0.5">
            {group.items.map(({ id, key }) => (
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
          </div>
        </div>
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
      {/* Mobile: barra sticky con toggle */}
      <div className="lg:hidden fixed top-14 left-0 right-0 z-40 bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 shadow-sm">
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {drawerOpen
              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
          </svg>
          <span>Contents</span>
        </button>
        {/* Sección activa */}
        {activeLabel && (
          <span className="text-sm text-avax-600 font-semibold truncate">
            → {t(activeLabel.key)}
          </span>
        )}
      </div>



      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            role="presentation"
            className="fixed inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
            onKeyDown={(e) => e.key === 'Escape' && setDrawerOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] bg-white p-4 shadow-xl overflow-y-auto">
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
