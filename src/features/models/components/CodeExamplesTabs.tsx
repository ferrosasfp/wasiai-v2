'use client'
import { useState } from 'react'

type Tab = 'curl' | 'node' | 'python'

interface Props {
  snippets: { curl: string; node: string; python: string }
  keysUrl: string
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'curl',   label: 'cURL' },
  { id: 'node',   label: 'Node.js' },
  { id: 'python', label: 'Python' },
]

export function CodeExamplesTabs({ snippets, keysUrl }: Props) {
  const [tab, setTab]       = useState<Tab>('curl')
  const [copied, setCopied] = useState(false)

  function copy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    navigator.clipboard.writeText(snippets[tab]).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {/* silent fail */})
  }

  return (
    <>
      {/* Tabs + copy button */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === t.id
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={copy}
          className="text-xs text-gray-400 hover:text-white transition-colors px-2 py-1"
        >
          {copied ? '✓ Copiado' : 'Copiar'}
        </button>
      </div>

      {/* Code */}
      <pre className="p-4 text-xs text-gray-100 overflow-x-auto leading-relaxed">
        <code>{snippets[tab]}</code>
      </pre>

      {/* Footer */}
      <div className="px-4 pb-3 text-xs text-gray-500">
        Reemplaza <span className="text-gray-300">wasi_YOUR_KEY</span> por tu API key.{' '}
        <a
          href={keysUrl}
          className="text-avax-400 hover:text-avax-300"
          target="_blank"
          rel="noreferrer"
        >
          Obtener API key →
        </a>
      </div>
    </>
  )
}
