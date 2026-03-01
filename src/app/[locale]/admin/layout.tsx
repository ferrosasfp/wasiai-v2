import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { ReactNode } from 'react'

/**
 * Layout protegido para el panel admin.
 * Verifica sesión de Supabase — si no hay sesión, redirect a /en.
 * La verificación de ownership se hace en el cliente con wallet.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/en')
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {children}
    </div>
  )
}
