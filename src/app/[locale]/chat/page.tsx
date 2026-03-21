import type { Metadata } from 'next'
import { ChatPageClient } from './_components/ChatPageClient'

export const metadata: Metadata = {
  title: 'Chat DeFi — WasiAI',
}

export default function ChatPage() {
  return <ChatPageClient />
}
