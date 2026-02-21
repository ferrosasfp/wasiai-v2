/**
 * WasiAI Demo Agents — powered by Groq (free tier)
 *
 * These agents are served at /api/demo/agents/[slug]
 * and registered as real agents in the marketplace.
 *
 * Each has: slug, name, description, category, price, system prompt
 */

export interface DemoAgent {
  slug:          string
  name:          string
  description:   string
  category:      'nlp' | 'code' | 'data' | 'multimodal'
  price_per_call: number
  mcp_tool_name:  string
  mcp_description: string
  system_prompt:  string
  input_example:  string
  output_example: string
  model?:         string
  max_tokens?:    number
  temperature?:   number
}

export const DEMO_AGENTS: DemoAgent[] = [
  {
    slug:          'wasi-summarizer',
    name:          'WasiSummarizer',
    description:   'Summarizes any text into a concise paragraph. Ideal for agents that need to compress large documents, news articles, or research papers.',
    category:      'nlp',
    price_per_call: 0.01,
    mcp_tool_name:  'wasi_summarizer',
    mcp_description: 'Summarize any text into a concise paragraph',
    system_prompt:
      'You are a precise text summarizer. Given any text, produce a concise summary in 2-4 sentences. Preserve key facts. Do not add commentary. Reply only with the summary.',
    input_example:  'The Industrial Revolution was a period of global transition...',
    output_example: 'The Industrial Revolution transformed manufacturing from manual to machine-based processes.',
    temperature:   0.2,
  },
  {
    slug:          'wasi-translator',
    name:          'WasiTranslator',
    description:   'Translates text between languages. Specify target language in the input. Supports 50+ languages.',
    category:      'nlp',
    price_per_call: 0.01,
    mcp_tool_name:  'wasi_translator',
    mcp_description: 'Translate text to any language. Include "to: <language>" in your input.',
    system_prompt:
      'You are a professional translator. The user will provide text and optionally specify a target language with "to: <language>". If no language is specified, translate to Spanish. Translate accurately, preserving tone and meaning. Reply only with the translated text.',
    input_example:  'Hello world, how are you today? to: Spanish',
    output_example: 'Hola mundo, ¿cómo estás hoy?',
    temperature:   0.1,
  },
  {
    slug:          'wasi-coder',
    name:          'WasiCoder',
    description:   'Explains code, generates functions, and debugs errors. Supports all major programming languages. Perfect for agents building automated dev workflows.',
    category:      'code',
    price_per_call: 0.02,
    mcp_tool_name:  'wasi_coder',
    mcp_description: 'Explain, generate, or debug code in any programming language',
    system_prompt:
      'You are an expert software engineer. Given code or a coding task, provide clear, concise, production-ready code or explanation. Be direct. Include only relevant code and a brief explanation. No unnecessary verbosity.',
    input_example:  'Write a TypeScript function that debounces a callback',
    output_example: 'function debounce(fn: Function, ms: number) { ... }',
    model:         'llama-3.1-8b-instant',
    temperature:   0.2,
    max_tokens:    2048,
  },
  {
    slug:          'wasi-sentiment',
    name:          'WasiSentiment',
    description:   'Analyzes sentiment and emotional tone of any text. Returns structured JSON with sentiment score, label, and detected emotions. Useful for monitoring, moderation, and market signals.',
    category:      'data',
    price_per_call: 0.01,
    mcp_tool_name:  'wasi_sentiment',
    mcp_description: 'Analyze sentiment and emotions in text. Returns structured JSON.',
    system_prompt:
      'You are a sentiment analysis engine. Analyze the text and respond ONLY with valid JSON in this exact format: {"sentiment": "positive"|"negative"|"neutral", "score": 0.0-1.0, "emotions": ["joy","anger","fear","sadness","surprise","disgust"], "confidence": 0.0-1.0}. No extra text.',
    input_example:  'I absolutely love this product! It changed my life.',
    output_example: '{"sentiment":"positive","score":0.97,"emotions":["joy"],"confidence":0.95}',
    temperature:   0.1,
  },
  {
    slug:          'wasi-extractor',
    name:          'WasiExtractor',
    description:   'Extracts structured data from unstructured text. Specify what to extract in the input. Returns clean JSON. Ideal for agents that need to parse emails, invoices, documents, or web pages.',
    category:      'data',
    price_per_call: 0.02,
    mcp_tool_name:  'wasi_extractor',
    mcp_description: 'Extract structured data (JSON) from any unstructured text',
    system_prompt:
      'You are a data extraction engine. Extract structured information from the provided text. Return ONLY valid JSON with the extracted fields. If the user specifies what to extract, use those fields. Otherwise extract all relevant entities (names, dates, amounts, locations, organizations). No commentary.',
    input_example:  'Invoice from Acme Corp, dated Jan 15 2025, amount $1,250.00, due Feb 15',
    output_example: '{"vendor":"Acme Corp","date":"2025-01-15","amount":1250.00,"due_date":"2025-02-15"}',
    temperature:   0.1,
  },
]

export function getDemoAgent(slug: string): DemoAgent | null {
  return DEMO_AGENTS.find(a => a.slug === slug) ?? null
}
