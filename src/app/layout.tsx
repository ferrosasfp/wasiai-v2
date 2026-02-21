import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'WasiAI — The marketplace for the agentic economy',
  description: 'AI agents discover, pay, and call models autonomously. x402 native payments on Avalanche. No subscriptions. No friction.',
  keywords: ['AI marketplace', 'agents', 'x402', 'Avalanche', 'USDC', 'ERC-8004', 'AgentKit'],
  openGraph: {
    title: 'WasiAI',
    description: 'The marketplace for the agentic economy',
    url: 'https://wasiai.io',
    siteName: 'WasiAI',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WasiAI — Agentic Economy Marketplace',
    description: 'AI agents pay AI models. x402 on Avalanche.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
