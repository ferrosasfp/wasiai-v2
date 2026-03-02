import type { ReactNode } from 'react'

/**
 * Layout del panel admin.
 * WAS-83: Sin dependencia de Supabase auth — wallet address es la identidad.
 * La verificación de owner/operator se hace en el cliente (admin/page.tsx).
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {children}
    </div>
  )
}
