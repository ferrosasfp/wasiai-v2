# Known Limitations

## WAS-224: CSP unsafe-inline for styles

**Status:** Known limitation — deferred  
**Risk:** LOW  
**CSP Directive:** `style-src 'self' 'unsafe-inline'`

### Why it exists
Tailwind CSS generates inline `style` attributes at build time. Next.js also injects inline styles for layout shift prevention. Both require `unsafe-inline` in `style-src`.

### Impact
An attacker who achieves HTML injection could inject `<style>` tags to visually deface the page. However, they **cannot** execute JavaScript through style injection — scripts are protected by CSP nonces.

### To fix (future)
1. Migrate all Tailwind utilities to external CSS files (major refactor)
2. Implement Next.js experimental `nonce` support for style tags
3. Use `style-src-elem` with hashes for known inline styles

### Why it's acceptable
- Script execution is fully protected (nonce-based)
- Style injection is cosmetic-only — no data exfiltration possible
- Industry standard: most Tailwind/Next.js apps use unsafe-inline for styles
