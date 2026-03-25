import type { Metadata, Viewport } from 'next'
import './globals.css'

// HU-MOBILE-NAV: viewport-fit=cover — PASO 1 CRÍTICO
// Sin esto, env(safe-area-inset-bottom) retorna 0 en iOS
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

const APP_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.wasiai.io'

export const metadata: Metadata = {
  title: 'WasiAI — The payment layer for AI agents',
  description: 'The payment layer for AI agents. Publish your agent, set a price per call, earn in USDC automatically. x402 native. Powered by Avalanche.',
  keywords: ['AI payment layer', 'AI agents', 'agent monetization', 'x402', 'Avalanche', 'USDC', 'ERC-8004', 'pay per call'],
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: 'WasiAI — Payment layer for AI agents',
    description: 'The payment layer for AI agents. Publish, set price, earn.',
    url: APP_URL,
    siteName: 'WasiAI',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WasiAI — Payment layer for AI agents',
    description: 'Publish your agent, set a price per call, earn in USDC. x402 native on Avalanche.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
