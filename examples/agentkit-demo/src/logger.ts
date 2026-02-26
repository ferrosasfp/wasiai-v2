const ts = () => new Date().toISOString()

export const log = {
  info:    (msg: string)                          => console.log(`[${ts()}] ℹ️  ${msg}`),
  error:   (msg: string, err?: unknown)           => console.error(`[${ts()}] ❌ ${msg}`, err ?? ''),
  success: (msg: string)                          => console.log(`[${ts()}] ✅ ${msg}`),
  warn:    (msg: string)                          => console.warn(`[${ts()}] ⚠️  ${msg}`),
  summary: (data: Record<string, unknown>)        => {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`[${ts()}] 🎉 DEMO COMPLETE`)
    for (const [k, v] of Object.entries(data)) {
      console.log(`  ${k}: ${v}`)
    }
    console.log('─'.repeat(60))
  },
}
