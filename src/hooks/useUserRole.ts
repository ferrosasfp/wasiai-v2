// src/hooks/useUserRole.ts
// HU-MOBILE-NAV: tipo canónico para UserRole

export type UserRole = 'creator' | 'consumer' | null

/**
 * Hook wrapper para el tipo UserRole.
 * En HU-MOBILE-NAV, el role viene como prop desde SSR (no hace fetch).
 * Este hook es el lugar canónico para el tipo — para uso futuro.
 */
export function useUserRole(role: UserRole): UserRole {
  return role
}
