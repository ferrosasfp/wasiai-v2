import { redirect } from 'next/navigation'

interface Props {
  params: Promise<{ locale: string }>
}

// Redirect legacy /dashboard → /creator/dashboard
export default async function DashboardRedirectPage({ params }: Props) {
  const { locale } = await params
  redirect(`/${locale}/creator/dashboard`)
}
