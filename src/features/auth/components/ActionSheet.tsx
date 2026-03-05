'use client'

import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

interface ActionSheetItem {
  icon: ReactNode
  label: string
  href?: string
  onClick?: () => void
  danger?: boolean
}

interface ActionSheetProps {
  open: boolean
  onClose: () => void
  items: ActionSheetItem[]
  title?: string
}

export function ActionSheet({ open, onClose, items, title }: ActionSheetProps) {
  const t = useTranslations('common')
  // Close on escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Prevent body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end sm:hidden">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div className="relative z-10 rounded-t-2xl bg-white pb-safe pt-2 shadow-xl">
        {/* Handle bar */}
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300" />

        {title && (
          <p className="mb-2 px-5 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {title}
          </p>
        )}

        <div className="divide-y divide-gray-100">
          {items.map((item, i) => {
            const baseClass = `flex w-full items-center gap-3 px-5 py-3.5 text-sm font-medium transition-colors ${
              item.danger
                ? 'text-red-600 hover:bg-red-50'
                : 'text-gray-800 hover:bg-gray-50'
            }`

            if (item.href) {
              return (
                <a key={i} href={item.href} className={baseClass} onClick={onClose}>
                  <span className="text-lg">{item.icon}</span>
                  {item.label}
                </a>
              )
            }

            return (
              <button
                key={i}
                type="button"
                className={baseClass}
                onClick={() => { item.onClick?.(); onClose() }}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </button>
            )
          })}
        </div>

        {/* Cancel */}
        <div className="mt-2 border-t border-gray-100 px-5 pb-4 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-gray-100 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-200 transition-colors"
          >
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
