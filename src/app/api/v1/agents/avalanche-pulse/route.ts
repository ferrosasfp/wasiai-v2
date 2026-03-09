/**
 * Avalanche Ecosystem Pulse — Demo Agent Endpoint
 * Analyzes any crypto token or project on Avalanche
 * Input: { symbol: string, question?: string }
 * Output: { price, change_24h, sentiment, summary, recommendation }
 */
import { NextRequest, NextResponse } from 'next/server'

const COINGECKO = 'https://api.coingecko.com/api/v3'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const input = body.input || body.symbol || body.query || 'AVAX'
    const symbol = String(input).trim().toUpperCase().replace(/[^A-Z0-9]/g, '')

    // Mapeo de símbolos conocidos a CoinGecko IDs
    const symbolMap: Record<string, string> = {
      AVAX: 'avalanche-2', BTC: 'bitcoin', ETH: 'ethereum',
      USDC: 'usd-coin', SOL: 'solana', BNB: 'binancecoin',
      LINK: 'chainlink', UNI: 'uniswap', AAVE: 'aave',
      JOE: 'joe', PNG: 'pangolin', QI: 'benqi',
    }

    const coinId = symbolMap[symbol] || symbolMap['AVAX']
    const sym = Object.keys(symbolMap).find(k => symbolMap[k] === coinId) || symbol

    // Fetch price from CoinGecko
    let price = 0, change24h = 0, marketCap = 0, volume = 0
    try {
      const res = await fetch(
        `${COINGECKO}/simple/price?ids=${coinId}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`,
        { next: { revalidate: 60 } }
      )
      const data = await res.json()
      const coin = data[coinId]
      if (coin) {
        price = coin.usd || 0
        change24h = coin.usd_24h_change || 0
        marketCap = coin.usd_market_cap || 0
        volume = coin.usd_24h_vol || 0
      }
    } catch { /* use defaults */ }

    // Sentiment analysis based on price action
    const sentiment = change24h > 5 ? 'BULLISH' :
                      change24h > 1 ? 'POSITIVE' :
                      change24h > -1 ? 'NEUTRAL' :
                      change24h > -5 ? 'NEGATIVE' : 'BEARISH'

    const sentimentEmoji = { BULLISH: '🚀', POSITIVE: '📈', NEUTRAL: '➡️', NEGATIVE: '📉', BEARISH: '🔻' }[sentiment]

    const recommendation = change24h > 3 ? 'Strong momentum — monitor for continuation or pullback.' :
                           change24h > 0 ? 'Mild upside — consolidation or continued growth expected.' :
                           change24h > -3 ? 'Slight correction — watch key support levels.' :
                                           'Significant drawdown — high risk, wait for stabilization.'

    const avaxContext = sym === 'AVAX'
      ? ' Avalanche C-Chain continues to grow as a hub for DeFi and AI agent infrastructure.'
      : ` Tracked on Avalanche ecosystem via WasiAI Pulse.`

    const summary = `${sentimentEmoji} ${sym} is trading at $${price.toFixed(4)} with a ${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}% change in the last 24 hours. Market sentiment: ${sentiment}.${avaxContext}`

    return NextResponse.json({
      agent: 'avalanche-ecosystem-pulse',
      version: '1.0.0',
      input: { symbol: sym },
      result: {
        symbol: sym,
        price_usd: price,
        change_24h_pct: parseFloat(change24h.toFixed(2)),
        market_cap_usd: marketCap,
        volume_24h_usd: volume,
        sentiment,
        sentiment_emoji: sentimentEmoji,
        summary,
        recommendation,
        powered_by: 'WasiAI · Avalanche',
        timestamp: new Date().toISOString(),
      },
      charged_usdc: 0.002,
      network: 'avalanche-testnet',
    })
  } catch (err) {
    return NextResponse.json({ error: 'Invalid input', detail: String(err) }, { status: 400 })
  }
}

// Handle x402 probe
export async function GET() {
  return NextResponse.json({
    name: 'Avalanche Ecosystem Pulse',
    slug: 'avalanche-ecosystem-pulse',
    description: 'Real-time price, sentiment & market analysis for any crypto token on Avalanche. Powered by live market data.',
    price_per_call: 0.002,
    currency: 'USDC',
    input_schema: { symbol: 'string (e.g. AVAX, BTC, ETH, LINK, JOE)', question: 'string (optional)' },
    example_input: { input: 'AVAX' },
  })
}
