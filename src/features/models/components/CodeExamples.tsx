// Server Component — ISR compatible, no 'use client'
import { CodeExamplesTabs } from './CodeExamplesTabs'

const BASE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wasiai-v2.vercel.app').replace(/\/$/, '')

interface Props {
  slug: string
  priceUsdc?: string | null
  inputExample?: string | null
}

function generateSnippets(slug: string, priceUsdc: string | null | undefined, inputExample: string) {
  const isFree = !priceUsdc
  const freeNote = isFree ? ' # free agent' : ''

  const curl =
`curl -X POST ${BASE_URL}/api/v1/agents/${slug}/invoke \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wasi_YOUR_KEY" \\
  -d '{"input": "${inputExample}"}'${freeNote}`

  const node =
`const response = await fetch(
  '${BASE_URL}/api/v1/agents/${slug}/invoke',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'wasi_YOUR_KEY', // or: npm install @wasiai/sdk
    },
    body: JSON.stringify({ input: '${inputExample}' }),
  }
)
const { output } = await response.json()
console.log(output)${freeNote ? '\n' + freeNote : ''}`

  const python =
`import requests

response = requests.post(
  '${BASE_URL}/api/v1/agents/${slug}/invoke',
  headers={
    'Content-Type': 'application/json',
    'X-API-Key': 'wasi_YOUR_KEY',
  },
  json={'input': '${inputExample}'}
)
print(response.json()['output'])${freeNote}`

  return { curl, node, python }
}

export function CodeExamples({ slug, priceUsdc, inputExample }: Props) {
  const example = inputExample ?? 'Hello, world!'
  const snippets = generateSnippets(slug, priceUsdc, example)
  const keysUrl = `${BASE_URL}/en/agent-keys`

  return (
    <div className="rounded-2xl bg-gray-900 overflow-hidden">
      <CodeExamplesTabs snippets={snippets} keysUrl={keysUrl} />
    </div>
  )
}
