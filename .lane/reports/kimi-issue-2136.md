# Lane evidence: kimi/issue-2136

Issue: Nishfleet/0509#2136 — growth2: Publish /sample-brief as one real Monday brief on a public page.

## What shipped

- `app/routes/sample-brief.tsx` (new): public route. Loader picks the newest
  indexable brand domain from `loadIndexableAdsInternalLinks` with >= 1 stored
  `watch_event` in the last 30 days and renders those rows through the existing
  `buildDigestEmail` renderer (via `buildSampleBriefDigest` in
  `app/lib/digest-email.server.ts`). Quiet-brief variant (real stored run
  counts) for the newest indexable domain when nothing filed; explicit empty
  state (200) when no brand is indexable.
- Privacy must-nots held: no workspace name, email, watchlist id, or
  non-indexable domain. Items carry no ids (deep links resolve to the public
  /ads/:domain page); reviewer line renders the generic "Workspace owner"
  fallback; event titles/summaries are scrubbed of the exact stored watchlist
  name. Bounded D1 reads only — no live scraping.
- CTA "Get this every Monday, free" ->
  `/auth/signup?competitor={domain}&source=sample_brief`; `sample_brief`
  allowlisted in `app/lib/signup-source.ts`.
- `app/routes.ts` registration; `/sample-brief` in `SITEMAP_PATHS`
  (`app/lib/seo.ts`) with llms.txt parity entry (`app/lib/public-markdown.ts`)
  and the fail-closed catalog pin (`tests/customer-claim-surface-registry.test.ts`).
  Frame styles in `app/app.css` (design-system ratchet forbids inline styles).
- `tests/sample-brief.route.test.ts` (new): fixture-domain brief render,
  no-leak assertions, quiet variant, empty-case 200, source contract.

## Proof

- Termination: `npx vitest run tests/sample-brief.route.test.ts && grep -q
  '"sample-brief"' app/routes.ts && grep -q '/sample-brief' app/lib/seo.ts`
  -> 5/5 passed, TERMINATION-OK.
- `npm run typecheck` clean.
- Full `npm test`: 641 + 42 files, 7580 + 206 tests passed.
- Merge with origin/main (after #2190/#2191 landed) resolved by keeping both
  lanes' entries in routes.ts / seo.ts / public-markdown.ts /
  customer-claim-surface-registry.test.ts.

PR: https://github.com/Nishfleet/0509/pull/2197
