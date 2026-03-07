# Work Item — 060: Sandbox testing banner

**Classification:** FAST-FIX
**Priority:** P2

## Problem
Sandbox uses testnet. Users may think results are production-quality.

## Fix
Add a visible but non-intrusive banner at the top of the sandbox page:
- EN: "🧪 Sandbox mode. This is a testing environment. Results may not reflect production accuracy."
- ES: "🧪 Modo sandbox. Este es un ambiente de prueba. Los resultados pueden no reflejar la precisión de producción."

## AC
1. Banner visible at top of sandbox page in both locales
2. Banner is not dismissible (always present)
3. Styled as info/warning (not error)
