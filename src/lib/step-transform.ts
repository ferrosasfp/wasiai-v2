import { callLLM } from '@/lib/agents/llm'

/**
 * Transforms the output of one pipeline step into the input format
 * expected by the next step, using an LLM fallback chain.
 *
 * Fail-open: on any error (including all providers failing), returns
 * the raw previousOutput so the pipeline is never blocked.
 */
export async function transformStepOutput(
  previousOutput: string,
  targetSchema: Record<string, unknown>,
  targetSlug: string,
): Promise<string> {
  const start = Date.now()

  try {
    const response = await callLLM({
      messages: [
        {
          role: 'system',
          content:
            'You are a JSON transformer. Convert the output of one AI agent into the input format required by the next agent. Return ONLY valid JSON matching the target schema. No explanation, no markdown, no code fences.',
        },
        {
          role: 'user',
          content: `Previous agent output:\n${previousOutput}\n\nTarget agent (${targetSlug}) expects input matching this JSON Schema:\n${JSON.stringify(targetSchema)}\n\nReturn the transformed JSON:`,
        },
      ],
      temperature: 0,
      maxTokens: 512,
    })

    try {
      const parsed = JSON.parse(response.result)
      console.warn('[step-transform]', {
        targetSlug,
        provider: response.provider,
        latency_ms: Date.now() - start,
        fallbackUsed: false,
      })
      return JSON.stringify(parsed)
    } catch {
      console.warn('[step-transform] invalid JSON from LLM, using raw output', {
        targetSlug,
        provider: response.provider,
        latency_ms: Date.now() - start,
        fallbackUsed: true,
      })
      return previousOutput
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    console.warn('[step-transform] all providers failed, using raw output', {
      targetSlug,
      error: error.message,
      latency_ms: Date.now() - start,
      fallbackUsed: true,
    })
    return previousOutput
  }
}
