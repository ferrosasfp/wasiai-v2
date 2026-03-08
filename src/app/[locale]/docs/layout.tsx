import type { ReactNode } from 'react'
import { DocsSidebar } from '@/features/docs/components/DocsSidebar'

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* lg: flex normal | mobile: columna con padding-top para barra sticky */}
        <div className="flex gap-8 py-8 pt-12 lg:pt-8">
          <DocsSidebar />
          <main className="min-w-0 flex-1 overflow-x-hidden">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
