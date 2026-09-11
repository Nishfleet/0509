# claim/issue-2146 — growth2: attribution + forward lines in the digest brief

Issue: Nishfleet/0509#2146. Unit: pi-issue-0509-2146. Base: origin/main @ d0ae8ec9.

## What landed

- Free-plan briefs (main, all-quiet, triage templates): footer line "Brief by
  Five to Nine. Watch one competitor free." linking
  `https://0509.io/?source=digest_footer`. Free signal = `upgradeNote`
  presence, which `deliverWeeklyDigest` sets only when `plan === "free"`.
- All plans, all three brief shapes: "Forward this to whoever needs it; every
  claim keeps its source link." under the decision summary (after the
  accountability block, before trend/Top-moves). On Starter+ the brief's
  existing share URL is appended via `input.forwardUrl` — the #2175
  resolve-or-create share-link machinery, already plan-gated on
  `share_links`. No new `shareUrl` field; nothing generates links on Free.
- Plain-text parts carry both lines in all three templates.
- `digest_footer` added to `ALLOWED_SIGNUP_SOURCES` and to both literal lists
  in `migrations/0087_signup_source_open_allowlist.sql` (underscore-bearing,
  so outside the #2108 open slug shape — same pattern as the `for_agencies`
  fix in 3b85dcf2e).

## Reconciliation notes

- Reused the #2175 `forwardUrl` (watermarked share view) instead of the
  salvaged commit's parallel `shareUrl` input, which no caller could populate.
- #2175's footer "Forward this brief to a teammate or client" line is
  unchanged; #2146's line is a separate ask under the decision summary.

## Verification

- `npx vitest run tests/digest-email.test.ts` → 94/94 pass (2 snapshots
  regenerated; diff is only the new forward/share lines).
- `grep -q 'digest_footer' app/lib/digest-email.server.ts` → match.
- `npx vitest run tests/signup-source.test.ts` → 16/16.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 334 files / 4216 tests pass.
- `npx vitest run --configLoader runner --project workers
  tests/integration/signup-source.integration.test.ts` → 8/8 (real D1 CHECK
  constraint write+read path).
