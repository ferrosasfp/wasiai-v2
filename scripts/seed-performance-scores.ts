/**
 * seed-performance-scores.ts — WAS-213
 * Seeds demo agents with realistic performance_score values (75–99).
 * Run with: npx ts-node scripts/seed-performance-scores.ts
 */
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!

const DEMO_SLUGS = [
  'image-generator',
  'text-summarizer',
  'code-reviewer',
  'sentiment-analyzer',
  'translation-agent',
  'data-extractor',
  'email-writer',
  'seo-optimizer',
]

function randomScore(): number {
  return Math.round((75 + Math.random() * 24) * 10) / 10
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

  const updates = DEMO_SLUGS.map(slug => ({ slug, performance_score: randomScore() }))

  for (const { slug, performance_score } of updates) {
    const { error } = await supabase
      .from('agents')
      .update({ performance_score })
      .eq('slug', slug)

    if (error) {
      console.warn(`[seed] Skipped ${slug}: ${error.message}`)
    } else {
      console.log(`[seed] ${slug} → performance_score = ${performance_score}`)
    }
  }

  const { count } = await supabase
    .from('agents')
    .select('*', { count: 'exact', head: true })
    .not('performance_score', 'is', null)

  console.log(`\n[seed] Agents with performance_score IS NOT NULL: ${count}`)
}

main().catch(err => { console.error(err); process.exit(1) })
