export function CollectionsDocsSection() {
  return (
    <section id="collections" className="scroll-mt-20 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Curated Collections</h2>
        <p className="mt-2 text-gray-600">
          Browse hand-picked groups of agents organized by use case. Collections help you find the right agents faster.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-lg font-semibold text-gray-900">What Are Collections?</h3>
        <p className="text-sm text-gray-700">
          Collections are curated groups of agents organized by theme — for example, &quot;Best for DeFi&quot;, &quot;Top Vision Agents&quot;, or &quot;Security Toolkit&quot;.
          Each collection has a cover image, description, and a sorted list of agents.
        </p>
        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
          <li>Browse all collections at <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">/collections</code></li>
          <li>View a specific collection at <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">/collections/:slug</code></li>
          <li>Featured collections appear on the homepage</li>
          <li>Collections are curated by the WasiAI team</li>
        </ul>
      </div>
    </section>
  )
}
