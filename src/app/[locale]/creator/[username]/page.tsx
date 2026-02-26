/**
 * /[locale]/creator/[username] — Public creator profile page
 *
 * HU-1.5: Perfil Público del Creator
 * ISR: 10 minutes
 */
import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import type { Metadata } from 'next'
import { getCreatorByUsername } from '@/features/creator/lib/getCreatorByUsername'
import { CreatorProfileView } from '@/features/creator/components/CreatorProfileView'

export const revalidate = 600

interface Props {
  params: Promise<{ locale: string; username: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params
  const creator = await getCreatorByUsername(username)
  if (!creator) {
    return { title: 'Creator no encontrado — WasiAI' }
  }
  return {
    title: `${creator.displayName} — Creator en WasiAI`,
    description: creator.bio ?? `Descubre los agentes de ${creator.displayName} en WasiAI`,
  }
}

export default async function CreatorProfilePage({ params }: Props) {
  const { locale, username } = await params
  setRequestLocale(locale)

  const creator = await getCreatorByUsername(username)
  if (!creator) notFound()

  return <CreatorProfileView creator={creator} locale={locale} />
}
