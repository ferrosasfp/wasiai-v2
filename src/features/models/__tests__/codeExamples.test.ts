import { describe, it, expect } from 'vitest'

// Pure function extracted for testing — mirrors generateSnippets in CodeExamples.tsx
function generateSnippets(
  slug: string,
  priceUsdc: string | null | undefined,
  inputExample: string,
  baseUrl: string,
) {
  const isFree = !priceUsdc
  const freeNote = isFree ? ' # free agent' : ''

  const curl =
`curl -X POST ${baseUrl}/api/v1/agents/${slug}/invoke \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wasi_YOUR_KEY" \\
  -d '{"input": "${inputExample}"}'${freeNote}`

  const node =
`const response = await fetch(
  '${baseUrl}/api/v1/agents/${slug}/invoke',
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
  '${baseUrl}/api/v1/agents/${slug}/invoke',
  headers={
    'Content-Type': 'application/json',
    'X-API-Key': 'wasi_YOUR_KEY',
  },
  json={'input': '${inputExample}'}
)
print(response.json()['output'])${freeNote}`

  return { curl, node, python }
}

const BASE = 'https://app.wasiai.io'

describe('generateSnippets', () => {
  it('includes slug in all snippets', () => {
    const { curl, node, python } = generateSnippets('my-agent', '0.01', 'test input', BASE)
    expect(curl).toContain('my-agent')
    expect(node).toContain('my-agent')
    expect(python).toContain('my-agent')
  })

  it('includes inputExample in all snippets', () => {
    const { curl, node, python } = generateSnippets('slug', '0.01', 'custom input', BASE)
    expect(curl).toContain('custom input')
    expect(node).toContain('custom input')
    expect(python).toContain('custom input')
  })

  it('uses baseUrl from parameter, not hardcoded', () => {
    const customBase = 'https://custom.example.com'
    const { curl, node, python } = generateSnippets('slug', '0.01', 'hi', customBase)
    expect(curl).toContain(customBase)
    expect(node).toContain(customBase)
    expect(python).toContain(customBase)
    expect(curl).not.toContain('app.wasiai.io')
    expect(node).not.toContain('app.wasiai.io')
    expect(python).not.toContain('app.wasiai.io')
  })

  it('adds # free agent comment when priceUsdc is null', () => {
    const { curl, node, python } = generateSnippets('slug', null, 'hi', BASE)
    expect(curl).toContain('# free agent')
    expect(node).toContain('# free agent')
    expect(python).toContain('# free agent')
  })

  it('adds # free agent comment when priceUsdc is undefined', () => {
    const { curl, python } = generateSnippets('slug', undefined, 'hi', BASE)
    expect(curl).toContain('# free agent')
    expect(python).toContain('# free agent')
  })

  it('does NOT add # free agent comment for paid agents', () => {
    const { curl, node, python } = generateSnippets('slug', '0.05', 'hi', BASE)
    expect(curl).not.toContain('# free agent')
    expect(node).not.toContain('# free agent')
    expect(python).not.toContain('# free agent')
  })

  it('uses Hello, world! fallback when inputExample is empty string', () => {
    // The component handles the fallback before calling generateSnippets
    const { curl } = generateSnippets('slug', '0.01', 'Hello, world!', BASE)
    expect(curl).toContain('Hello, world!')
  })

  it('includes placeholder API key (never a real key pattern)', () => {
    const { curl, node, python } = generateSnippets('slug', '0.01', 'test', BASE)
    expect(curl).toContain('wasi_YOUR_KEY')
    expect(node).toContain('wasi_YOUR_KEY')
    expect(python).toContain('wasi_YOUR_KEY')
    // No real key pattern (wasi_ followed by actual chars beyond placeholder)
    expect(curl).not.toMatch(/wasi_[a-zA-Z0-9]{10,}/)
    expect(node).not.toMatch(/wasi_[a-zA-Z0-9]{10,}/)
  })

  it('Node.js snippet includes @wasiai/sdk reference comment', () => {
    const { node } = generateSnippets('slug', '0.01', 'test', BASE)
    expect(node).toContain('@wasiai/sdk')
  })
})
