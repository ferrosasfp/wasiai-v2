/**
 * Agent 3 — Smart Contract Auditor
 * KITE AI STATUS: NOT AVAILABLE (verified 2026-02-28)
 * Fallback: Groq llama-3.3-70b-versatile with specialized audit prompt
 *
 * Technical debt DT-001: integrate Kite AI when API becomes available.
 */
import { callGroq } from '@/lib/agents/groq'
import type { AuditResult, AuditFinding } from './types'

const AUDIT_SYSTEM_PROMPT = `You are a senior smart contract security auditor specializing in EVM/Avalanche DeFi contracts.

Given a token contract address and optionally its ABI or source, analyze for:
1. Rug pull mechanisms (hidden owner functions, drainable liquidity, emergency withdraw)
2. Honeypot patterns (sell restrictions, blacklist functions, transfer fees >10%)
3. Dangerous permissions (mint without cap, pause all transfers, setFee, blacklist/whitelist)
4. Centralization risks (single owner, upgradeable proxy without timelock)
5. Common vulnerabilities (reentrancy, integer overflow, unchecked returns)

RESPOND ONLY with valid JSON in this exact format, no extra text:
{
  "findings": [
    {
      "severity": "CRITICAL|HIGH|MEDIUM|LOW|INFO",
      "title": "Short title",
      "description": "What it means and why it matters"
    }
  ],
  "summary": "2-3 sentence overall assessment"
}`

export async function auditContract(
  tokenAddress: string,
  contractSource?: string,
): Promise<AuditResult> {
  const userContent = contractSource
    ? `Token address: ${tokenAddress}\n\nContract source/ABI:\n${contractSource.slice(0, 8000)}`
    : `Token address: ${tokenAddress}\n\nNo source code provided. Analyze based on the address and any known patterns for this type of contract on Avalanche Fuji testnet. Focus on common DeFi risks.`

  try {
    const response = await callGroq({
      messages: [
        { role: 'system', content: AUDIT_SYSTEM_PROMPT },
        { role: 'user',   content: userContent },
      ],
      model:       'llama-3.3-70b-versatile',
      maxTokens:   1024,
      temperature: 0,  // Deterministic for consistency
    })

    let parsed: { findings: AuditFinding[]; summary: string }
    try {
      parsed = JSON.parse(response.result)
    } catch {
      // LLM returned non-JSON — wrap in a single finding
      parsed = {
        findings: [{
          severity: 'INFO' as const,
          title: 'Analysis completed',
          description: response.result.slice(0, 500),
        }],
        summary: response.result.slice(0, 200),
      }
    }

    // Validate and sanitize severities
    const validSeverities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
    const findings: AuditFinding[] = (parsed.findings ?? []).map(f => ({
      severity:    validSeverities.includes(f.severity) ? f.severity : 'INFO',
      title:       String(f.title ?? '').slice(0, 100),
      description: String(f.description ?? '').slice(0, 500),
    })) as AuditFinding[]

    return {
      token_address: tokenAddress,
      findings,
      summary:    String(parsed.summary ?? '').slice(0, 500),
      powered_by: 'groq-llama',
    }
  } catch (err) {
    return {
      token_address: tokenAddress,
      findings: [],
      summary: 'Audit unavailable',
      powered_by: 'groq-llama',
      error: String(err).slice(0, 200),
    }
  }
}
