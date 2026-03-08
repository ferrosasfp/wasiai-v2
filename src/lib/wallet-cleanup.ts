/**
 * Clear wallet state from localStorage on logout.
 * Called client-side after Supabase signOut to prevent stale wallet UI.
 * HU-071: thirdweb keys kept in cleanup for graceful transition (users
 * who had thirdweb sessions will get them cleared on next logout).
 */
export function clearWalletState(): void {
  if (typeof window === 'undefined') return

  const keysToRemove: string[] = []

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (
      key &&
      (key.startsWith('wagmi') ||
        key.startsWith('thirdweb') ||
        key.startsWith('tw-'))
    ) {
      keysToRemove.push(key)
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key))
}
