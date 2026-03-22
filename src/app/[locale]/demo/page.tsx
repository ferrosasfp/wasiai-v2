import type { Metadata } from 'next'
import { DemoPageClient } from './_components/DemoPageClient'

export const metadata: Metadata = {
  title: 'Autonomous Demo — WasiAI',
}

export default function DemoPage() {
  return <DemoPageClient />
}
