/**
 * Verifica si un agente está dentro del scope de una key.
 * Lógica OR: dentro de allowed_slugs OR dentro de allowed_categories.
 * Sin scope (null/null) = acceso total.
 */
export function isAgentInScope(
  agentSlug:         string,
  agentCategory:     string,
  allowedSlugs:      string[] | null,
  allowedCategories: string[] | null,
): boolean {
  // Sin scope = acceso total (backward compatible)
  if (!allowedSlugs && !allowedCategories) return true

  // Lógica OR
  if (allowedSlugs && allowedSlugs.includes(agentSlug)) return true
  if (allowedCategories && allowedCategories.includes(agentCategory)) return true

  return false
}
