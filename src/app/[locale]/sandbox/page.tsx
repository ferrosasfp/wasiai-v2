/**
 * /[locale]/sandbox — Server wrapper con auth guard
 * Redirige a login si no hay sesión activa
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SandboxClient } from './SandboxClient'

export default async function SandboxPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect(`/${locale}/login`)

  return <SandboxClient userId={user.id} />
}
