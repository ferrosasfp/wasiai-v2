# Build Report — WAS-259

## Wave 0 — Pre-flight ✅

- **randomBytes**: already imported (`import { randomBytes } from 'crypto'`)
- **`const { data: userData, error: createError }`**: located in case 8 (~line 263)
- **Rollback 1** (`deleteUser`): in `if (keyError)` block after agent_keys insert
- **Rollback 2** (`deleteUser`): in `if (agentError || !agent)` block after agents insert
- **`userData.user.id` references**: 3 total — `owner_id`, `creator_id`, and 2 rollback calls

## Wave 1 — Implementation ✅

All 4 changes applied:

1. **Cambio 1**: Reestructured `userData` declaration → `userId: string | null`, `isExistingUser: boolean`, `newUserData`
2. **Cambio 2**: Replaced `if (createError)` block with email-exists resolution via `listUsers`
3. **Cambio 3**: All 2 `userData.user.id` refs replaced with `userId` (`owner_id` + `creator_id`)
4. **Cambio 4**: Both `deleteUser` rollback calls wrapped with `if (!isExistingUser)`

## TypeScript Build Gate ✅

```
npx tsc --noEmit → (no output — clean)
```

## Commit

```
[main 2ad193183] fix(onboard): WAS-259 multi-agent same email — link to existing creator
 1 file changed, 43 insertions(+), 15 deletions(-)
```

**Hash**: `2ad193183`

## Summary

When a second agent is registered with an email that already exists in Supabase Auth, the wizard now:
1. Detects the 422/email_exists error
2. Looks up the existing user via `listUsers`
3. Associates the new agent to that existing creator
4. Skips zombie-user cleanup (since we didn't create the user)
