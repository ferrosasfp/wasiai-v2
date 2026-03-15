# WAS-210 Docs Update — Build Report

**Date:** 2026-03-14  
**Sprint:** WAS-210  
**Builder:** NexusAgil v1.3

## Files Modified

| File | Change |
|------|--------|
| `src/features/docs/components/DocsSidebar.tsx` | Replaced flat `SECTION_KEYS` with grouped `NAV_GROUPS`, new `NavList` renders group labels |
| `src/features/docs/content/api-reference.tsx` | Removed TryIt; updated invoke path, auth header, added `/capabilities` + `/agents/register` endpoints |
| `src/features/docs/content/discovery.tsx` | Full rewrite using `/api/v1/capabilities`, real query params, updated code examples |
| `src/features/docs/content/errors.tsx` | Added 7 new Sprint 3 error codes, added `422` to `STATUS_COLOR` |
| `src/features/docs/content/creator-guide.tsx` | Updated endpoint contract body format, publish path to `/api/v1/agents/register`, added tags section |
| `src/features/docs/content/quickstart.tsx` | Updated auth header to `x-agent-key: wasi_...`, body to `{"input":{...}}`, URL to `/api/v1/agents/:slug/invoke` |
| `messages/en.json` | Added: `gettingStarted`, `invoking`, `advanced`, `forCreators`, `reference` |
| `messages/es.json` | Added: `gettingStarted`, `invoking`, `advanced`, `forCreators`, `reference` (translated) |

## Build Gates

| Gate | Result |
|------|--------|
| `tsc --noEmit` | ✅ 0 errors |
| `npm run lint` | ✅ 0 errors, 0 warnings |

## Commit

```
feat(WAS-210): documentación reorganizada — grupos en sidebar, /capabilities, tags, nuevos error codes, sin TryIt
22161d0
```

## Notes

- No git push performed (per spec)
- No files modified outside the specified list
- `discovery` key already existed in both message files — not duplicated
