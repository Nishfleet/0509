# Lane evidence — claim/issue-2817 (issue Nishfleet/0509#2817)

Scope: check every call site attaching `x-0509-canary-token` for (a) canonical
https://0509.io base-URL validation and (b) `redirect: "manual"` + per-hop
revalidation, reusing `fetchCanary`/`validateCanonicalBaseUrl` where applicable.

## Finding

All three files the issue named (`scripts/gate-c-soak.mjs`,
`scripts/provider-bakeoff.lib.mjs`, `scripts/prod-canary.lib.mjs`) were deleted
when `scripts/` was emptied in the `zero()`/`cut()` commits (`9b42b7e52`,
`469f8f2eb`, `3d4e1b8c3`, `c3b3a7595`, `ad0af2e42`) — along with the
`fetchCanary`/`validateCanonicalBaseUrl` helpers PR #2815 hardened. Repo sweep
(779 JS/TS files): zero outbound attach sites survive; the header is only read
server-side (`canary-token.server.ts`, `canary-release-identity.server.ts`) or
attached in mocked requests under `tests/`.

## Decision

Durable close = detector, not patch: `tests/canary-token-redirect-guard.test.ts`
scans JS/TS sources repo-wide and fails any attach site that lacks the
canonical-origin evidence and an in-window `redirect: "manual"` — the issue's
(a)+(b) as a regression trip-wire, in the `vitest-reporter-convention` idiom.

## Verification (this worktree)

- `npx vitest run tests/canary-token-redirect-guard.test.ts` — 1 passed
- Synthetic probes: unguarded attach, helper-mention-only, and
  `0509.io.attacker.com` attaches all flagged; guarded inline fetch,
  `fetchCanary`-routed, type-annotation and `.d.ts` shapes all pass
- `npx vitest run --configLoader runner --project node --changed origin/main`
  — 1 passed (only the new file affected)
- `semgrep --config p/default --baseline-commit <merge-base>` — clean
- Reviewer round (senior group): no blocking findings; 5 non-blocking
  hardening items acted on (helper exemption dropped, canonical literal
  anchored, case-insensitive literal, scan sanity assert, type-entry skip)

## Preserved invariants

- No production code touched; `tests/` additions only (+ the `.lane` record)
- Server-side header reads (`headers.get`) are not attach sites — verified
  zero matches on the live tree before and after hardening
