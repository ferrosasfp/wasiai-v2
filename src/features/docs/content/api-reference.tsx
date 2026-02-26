import { EndpointCard } from '../components/EndpointCard'
import { TryIt } from '../components/TryIt'

export function ApiReferenceSection() {
  return (
    <section id="api-reference" className="scroll-mt-20 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">API Reference</h2>
        <p className="mt-2 text-gray-600">
          Base URL: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">https://wasiai.com/api/v1</code>
          <br />
          Auth: send your API key as <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm">X-API-Key: wai_...</code> header.
        </p>
      </div>

      <EndpointCard
        method="POST"
        path="/agents/:slug/invoke"
        description="Invoke an agent with a JSON payload. Returns the agent's output synchronously."
        auth={true}
        params={[
          { name: ':slug', type: 'string', required: true, description: 'Agent slug identifier' },
        ]}
        bodyParams={[
          { name: 'input', type: 'string | object', required: true, description: 'Input to send to the agent' },
        ]}
        responseExample={`{
  "output": "Hola mundo",
  "latencyMs": 342,
  "agentSlug": "translator-es"
}`}
      />

      <EndpointCard
        method="GET"
        path="/agents"
        description="List all available agents. Supports filtering by category and pagination."
        auth={false}
        bodyParams={[
          { name: 'category', type: 'string', description: 'Filter by category (nlp, vision, audio…)' },
          { name: 'limit', type: 'number', description: 'Max results (default: 20, max: 100)' },
          { name: 'offset', type: 'number', description: 'Pagination offset (default: 0)' },
        ]}
        responseExample={`[
  {
    "slug": "translator-es",
    "name": "Translator ES",
    "description": "Translates text to Spanish",
    "category": "nlp",
    "pricePerCall": 0.001,
    "status": "active"
  }
]`}
      />

      <EndpointCard
        method="GET"
        path="/agents/:slug"
        description="Get full details for a single agent including schema, pricing, and creator info."
        auth={false}
        params={[
          { name: ':slug', type: 'string', required: true, description: 'Agent slug identifier' },
        ]}
        responseExample={`{
  "slug": "translator-es",
  "name": "Translator ES",
  "description": "Translates text to Spanish",
  "category": "nlp",
  "pricePerCall": 0.001,
  "status": "active",
  "creator": { "username": "alice" },
  "inputSchema": { "type": "object" }
}`}
      />

      <EndpointCard
        method="POST"
        path="/agents/register"
        description="Register a new agent on the marketplace. The creator must have a connected wallet."
        auth={true}
        bodyParams={[
          { name: 'slug', type: 'string', required: true, description: 'Unique slug for the agent' },
          { name: 'name', type: 'string', required: true, description: 'Display name' },
          { name: 'description', type: 'string', required: true, description: 'Short description' },
          { name: 'endpoint', type: 'string', required: true, description: 'HTTPS URL where the agent is hosted' },
          { name: 'pricePerCall', type: 'number', required: true, description: 'Price in AVAX per invocation' },
          { name: 'category', type: 'string', description: 'Category tag' },
        ]}
        responseExample={`{
  "slug": "my-agent",
  "status": "pending",
  "message": "Agent registered. It will be reviewed before going live."
}`}
      />

      {/* TryIt widget */}
      <div className="mt-8">
        <TryIt />
      </div>
    </section>
  )
}
