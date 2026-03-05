import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSafeOrigin } from '@/lib/security/allowed-origins'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')

  // Validate `next` to prevent open redirect attacks
  const nextRaw = searchParams.get('next') ?? `/${locale}/dashboard`
  const next = nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : `/${locale}/dashboard`

  // NG-001: Usar origin validado contra allowlist (evita x-forwarded-host spoofing)
  const safeOrigin = getSafeOrigin(request)

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      return NextResponse.redirect(`${safeOrigin}${next}`)
    }
  }

  return NextResponse.redirect(`${safeOrigin}/${locale}/login?error=auth_callback_error`)
}
