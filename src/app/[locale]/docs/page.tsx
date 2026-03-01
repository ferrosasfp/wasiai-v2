import { getTranslations } from 'next-intl/server'
import { QuickstartSection } from '@/features/docs/content/quickstart'
import { SdkNodeSection } from '@/features/docs/content/sdk-node'
import { SdkPythonSection } from '@/features/docs/content/sdk-python'
import { ApiReferenceSection } from '@/features/docs/content/api-reference'
import { McpSection } from '@/features/docs/content/mcp'
import { ErrorsSection } from '@/features/docs/content/errors'
import { X402Section }        from '@/features/docs/content/x402'
import { ComposeSection }     from '@/features/docs/content/compose'
import { AgentKeysSection }   from '@/features/docs/content/agent-keys'
import { CreatorGuideSection } from '@/features/docs/content/creator-guide'
import { AgentKitSection }    from '@/features/docs/content/agentkit'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'docs' })
  return {
    title: `${t('title')} — WasiAI`,
    description: 'WasiAI API docs: quickstart, SDKs, API reference and error codes.',
  }
}

export default function DocsPage() {
  return (
    <div className="space-y-16 pb-24">
      {/* Page header */}
      <div className="border-b border-gray-200 pb-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-gray-900">Documentation</h1>
        <p className="mt-3 text-lg text-gray-500 max-w-2xl">
          Everything you need to integrate WasiAI agents into your product.
          Pick your SDK, grab an API key, and ship.
        </p>
      </div>

      <QuickstartSection />
      <div className="border-t border-gray-100 pt-8">
        <SdkNodeSection />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <SdkPythonSection />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <ApiReferenceSection />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <McpSection />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <ErrorsSection />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <X402Section />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <ComposeSection />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <AgentKeysSection />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <CreatorGuideSection />
      </div>
      <div className="border-t border-gray-100 pt-8">
        <AgentKitSection />
      </div>
    </div>
  )
}
