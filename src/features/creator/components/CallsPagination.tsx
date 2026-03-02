'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

interface Props {
  currentPage: number
  totalPages: number
}

export function CallsPagination({ currentPage, totalPages }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (totalPages <= 1) return null

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('callsPage', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
      <button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage === 1}
        className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Anterior
      </button>
      <span>Página {currentPage} de {totalPages}</span>
      <button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Siguiente →
      </button>
    </div>
  )
}
