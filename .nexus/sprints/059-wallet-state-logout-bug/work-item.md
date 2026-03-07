# Work Item — 059: Wallet state persists after logout

**Classification:** FAST-FIX
**Priority:** P1

## Problem
When a user logs out of Supabase, the wagmi/thirdweb wallet state persists in localStorage. Visiting the agent detail page shows "Connected" even when not logged in.

## Fix
On Supabase logout (signOut action), clear wallet state:
1. Disconnect thirdweb wallet if active
2. Disconnect wagmi wallet if active
3. Clear relevant localStorage keys

## AC
1. User logs out → wallet shows disconnected on all pages
2. User visits agent detail without login → no "Connected" state visible
