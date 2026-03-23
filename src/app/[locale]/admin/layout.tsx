import type { ReactNode } from 'react'
import Link from 'next/link'

/**
 * Layout del panel admin.
 * WAS-83: Sin dependencia de Supabase auth — wallet address es la identidad.
 * La verificación de owner/operator se hace en el cliente (admin/page.tsx).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Admin nav */}
      <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto max-w-6xl flex items-center gap-6 px-8 py-3">
          <Link href="/admin" className="text-sm font-semibold text-avax-400 hover:text-avax-300">
            ⚡ Admin
          </Link>
          <Link href="/admin/agents" className="text-sm text-gray-400 hover:text-white transition">
            Agents
          </Link>
        </div>
      </nav>
      {children}
    </div>
  )
}
