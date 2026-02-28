/**
 * Agent 4 — DeFi Sentiment Analyzer
 * Analyzes token name, symbol, and description for red flags
 */
import { callGroq } from '@/lib/agents/groq'
import type { SentimentResult } from './types'

const SENTIMENT_SYSTEM_PROMPT = `You are a DeFi fraud detection specialist. Analyze a token's name, symbol, and description for warning signs.

Look for:
- FOMO/hype naming ("Moon", "Safe", "Gem", "100x", "ElonBased", "Turbo")
- Impersonation of legitimate projects ("SafeMoon", "BabyETH", "MiniDOGE")
- Unrealistic promises in description ("guaranteed returns", "rugproof", "fully audited" without proof)
- Anonymous team + aggressive marketing language
- Legitimate indicators (real utility description, team transparency, verifiable use case)

RESPOND ONLY with valid JSON, no extra text:
{
  "sentiment_score": <integer 0-100, where 0=very clean, 100=very suspicious>,
  "flags": ["list", "of", "detected", "red", "flags"],
  "analysis": "2-3 sentence explanation"
}`

export async function analyzeSentiment(
  tokenName: string,
  tokenSymbol: string,
  description?: string,
): Promise<SentimentResult> {
  const userContent = `Token name: ${tokenName}
Symbol: ${tokenSymbol}
Description: ${description ? description.slice(0, 1000) : 'Not provided'}`

  try {
    const response = await callGroq({
      messages: [
        { role: 'system', content: SENTIMENT_SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
      model:       'llama-3.3-70b-versatile',
      maxTokens:   512,
      temperature: 0,
    })

    let parsed: { sentiment_score: number; flags: string[]; analysis: string }
    try {
      parsed = JSON.parse(response.result)
    } catch {
      parsed = {
        sentiment_score: 50,
        flags: ['Parse error — manual review recommended'],
        analysis: response.result.slice(0, 200),
      }
    }

    return {
      token_name:      tokenName,
      token_symbol:    tokenSymbol,
      sentiment_score: Math.min(100, Math.max(0, Number(parsed.sentiment_score ?? 50))),
      flags:           Array.isArray(parsed.flags) ? parsed.flags.map(f => String(f).slice(0, 100)) : [],
      analysis:        String(parsed.analysis ?? '').slice(0, 500),
    }
  } catch (err) {
    return {
      token_name:      tokenName,
      token_symbol:    tokenSymbol,
      sentiment_score: 50,
      flags:           [],
      analysis:        'Sentiment analysis unavailable',
      error:           String(err).slice(0, 200),
    }
  }
}
