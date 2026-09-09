## What changed

- **New public route `/sample-brief`** (`app/routes/sample-brief.tsx`, registered in `app/routes.ts`): picks the newest sitemap-indexable brand domain from `loadIndexableAdsInternalLinks` (the sitemap's own indexability signal, so demo/stale/noindex domains can never be picked) that has at least one stored `watch_event` in the last 30 days, and builds its digest HTML through the existing `buildDigestEmail` renderer from stored rows only. When no indexable domain has a filed change, the honest all-quiet brief variant renders for the newest indexable domain; when no brand is indexable at all, the page renders an explicit empty state (still 200).
- **Privacy (must-nots) held**: the digest items carry no event/watchlist ids (so the digest builder's per-item deep links resolve to the public `/ads/:domain` page, never a customer workspace row), the accountable-reviewer line renders the generic "Workspace owner" fallback, and the title is derived from the event type (system vocabulary) with a generic safe summary — the stored title/summary (which can embed the owner's watchlist name, user id, or email) is never used verbatim. No workspace name, email, watchlist id, or non-indexable domain leaves the page. Bounded D1 reads only — no live scraping.
- **CTA**: "Get this every Monday, free" → `/auth/signup?competitor={domain}&source=sample_brief`; `sample_brief` added to the signup-source allowlist (`app/lib/signup-source.ts`).
- **SEO**: `/sample-brief` added to `SITEMAP_PATHS` in `app/lib/seo.ts` (weekly, 0.6) with the matching llms.txt entry in `app/lib/public-markdown.ts` (compile-time parity check) and the fail-closed sitemap catalog pin in `tests/customer-claim-surface-registry.test.ts`.
- **Test**: `tests/sample-brief.route.test.ts` — renders a brief for a fixture domain, proves no workspace name/email/watchlist id leaks, covers the quiet and empty (200) variants, and pins the route/sitemap/signup-source contract.

## Termination

`npx vitest run tests/sample-brief.route.test.ts && grep -q '"sample-brief"' app/routes.ts && grep -q '/sample-brief' app/lib/seo.ts`

Last lines:

```
 Test Files  1 passed (1)
      Tests  8 passed (8)

TERMINATION-OK
```

Also green: `npm run typecheck` and the affected sitemap/signup-source/public-markdown/customer-claim tests (123 passed).

## Verification

- `npx vitest run --configLoader runner --project node tests/sample-brief.route.test.ts` → 8 passed.
- `npm run typecheck` → clean.
- `npx vitest run --configLoader runner --project node tests/customer-claim-surface-registry.test.ts tests/public-markdown.test.ts tests/signup-source.test.ts tests/sitemap.server.test.ts` → 123 passed.
- Full node suite: 648/649 files passed (1 unrelated flaky timeout in `tests/local-release-server.test.ts`, passes in isolation).

run-proof: `npx vitest run --configLoader runner --project node tests/sample-brief.route.test.ts` (8 passed) + `npm run typecheck` (clean) + termination grep checks (routes.ts + seo.ts both OK).

net-positive-because: new public growth page (/sample-brief) with its route, server module, sitemap/llms.txt/signup-source wiring, and a 344-line test file — the diff is product surface, not control-plane machinery.

## Review (cursor/cursor-grok-4.6-high)

- **Act on**: extracted only a known-safe metadata allowlist into the digest items (the raw stored metadata can embed `proofTargetIdentity`, which carries the watchlist id) — the whole record is never spread. Hoisted the advertiser-watchlist read out of the per-domain loop so a crawl never issues a full-table scan per candidate. Added `proofTargetIdentity` to the test fixture and assert it never reaches the digest.
- **Consider**: derived the digest `fullDigestUrl`/`manageFrequencyUrl` from `appBaseUrl(env)` instead of hardcoding `https://0509.io`, so preview/staging links stay on the right origin.
- **Noted**: the sample brief is honestly thinner than a real customer brief (no change-intelligence summary) — acceptable, no fabrication.
- **Dismissed**: none.

Closes #2136
