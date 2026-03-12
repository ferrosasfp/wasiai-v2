import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function AgentKeysLayout({ children, params }: Props) {
  const { locale } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${locale}/login?next=/${locale}/agent-keys`)
  }

  return <>{children}</>
}
