'use client'

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

interface Props {
  content: string
  className?: string
  maxHeightClass?: string
}

export function CopyableOutput({ content, className = '', maxHeightClass = 'max-h-64' }: Props) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative">
      <pre className={`text-xs bg-gray-50 border border-gray-100 rounded-xl p-3 overflow-auto whitespace-pre-wrap font-mono ${maxHeightClass} ${className}`}>
        {content}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 text-gray-400 hover:text-gray-700 bg-white border border-gray-200 rounded-lg p-1.5 transition-colors"
        title="Copy"
      >
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
    </div>
  )
}
