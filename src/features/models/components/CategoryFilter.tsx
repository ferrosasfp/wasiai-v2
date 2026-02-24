'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { ModelCategory } from '../types/models.types'

const CATEGORIES: { value: ModelCategory | 'all'; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: '✨' },
  { value: 'nlp', label: 'NLP', icon: '💬' },
  { value: 'vision', label: 'Vision', icon: '👁' },
  { value: 'audio', label: 'Audio', icon: '🎵' },
  { value: 'code', label: 'Code', icon: '💻' },
  { value: 'multimodal', label: 'Multimodal', icon: '🤖' },
  { value: 'data', label: 'Data', icon: '📊' },
]

export function CategoryFilter() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const current = searchParams.get('category') ?? 'all'

  function handleSelect(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') {
      params.delete('category')
    } else {
      params.set('category', value)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {CATEGORIES.map((cat) => (
        <button
          key={cat.value}
          onClick={() => handleSelect(cat.value)}
          className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
            current === cat.value
              ? 'bg-avax-500 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <span>{cat.icon}</span>
          {cat.label}
        </button>
      ))}
    </div>
  )
}
