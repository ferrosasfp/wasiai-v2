import { WasiAIError } from './errors'

export function assertSlug(slug: unknown): asserts slug is string {
  if (!slug || typeof slug !== 'string' || slug.trim() === '') {
    throw new WasiAIError('slug must be a non-empty string')
  }
}
