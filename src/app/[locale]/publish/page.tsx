import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PublishForm from './PublishForm'

interface Props {
  params: Promise<{ locale: string }>
}

// UX-01: Auth gate — redirect to login if not authenticated
export default async function PublishPage({ params }: Props) {
  const { locale } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${locale}/login?next=/${locale}/publish`)
  }

  return <PublishForm />
}
