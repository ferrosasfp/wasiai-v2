/**
 * /[locale]/sandbox — Public sandbox for testing agents
 * No auth required — anyone can try agents
 */
import { createClient } from '@/lib/supabase/server'
import { SandboxClient } from './SandboxClient'

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return <SandboxClient userId={user?.id ?? null} />
}
