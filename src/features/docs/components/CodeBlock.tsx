'use client'

import { useState } from 'react'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import bash from 'highlight.js/lib/languages/bash'
import json from 'highlight.js/lib/languages/json'
import 'highlight.js/styles/github-dark.css'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('json', json)

export interface CodeTab {
  label: string
  language: string
  code: string
}

interface CodeBlockProps {
  tabs: CodeTab[]
}

export function CodeBlock({ tabs }: CodeBlockProps) {
  const [activeTab, setActiveTab] = useState(0)
  const [copied, setCopied] = useState(false)

  const current = tabs[activeTab]

  async function handleCopy() {
    if (!current) return
    await navigator.clipboard.writeText(current.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!current) return null
  const highlighted = hljs.highlight(current.code, { language: current.language }).value

  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 bg-[#0d1117] text-sm">
      {/* Tabs */}
      <div className="flex items-center gap-0 border-b border-gray-800 bg-[#161b22]">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(i)}
            className={`px-4 py-2 text-xs font-medium transition-colors ${
              i === activeTab
                ? 'text-white border-b-2 border-avax-500'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="ml-auto pr-2">
          <button
            onClick={handleCopy}
            className="rounded px-2 py-1 text-xs text-gray-400 hover:text-white transition"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>
      {/* Code */}
      <pre className="overflow-x-auto p-4 text-xs sm:text-sm leading-relaxed text-gray-300">
        <code
          dangerouslySetInnerHTML={{ __html: highlighted }}
          className={`language-${current.language}`}
        />
      </pre>
    </div>
  )
}
