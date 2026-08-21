# Lane 1 — promote public search out of shadow (2026-08-21)

**Item**: Promote public search out of shadow so customers get the
verified-advertiser filter that production already computes and throws away —
a nykaa.com search still serves 13 other brands' ads.

**Verdict**: the flag flip itself landed on 2026-08-12 (PR #685, `70faea05`)
and is live. Re-verified today against production. Two of the item's own
acceptance clauses were still open, and both are closed here:
the promotion record was never written, and nothing in `npm test` could stop
the flag from sliding back into shadow.

## Live re-verification (2026-08-21, anonymous, no credentials)

| Check | Result |
| --- | --- |
| `GET /api/health` → `releaseIdentity.searchRolloutMode` | `v2` (worker `0097fc57-c27d-4097-88dc-0862ede8d683`) |
| `/search?…&website=https%3A%2F%2Fnykaa.com` | HTTP 200, **"16 verified ads linked to nykaa.com across all countries"** (shadow served 28 unfiltered) |
| Same URL, keyword-only brands from the 2026-08-12 capture | `Maybelline New York` → 0 hits, `Indulekha` → 0 hits |
| `/search?…&website=https%3A%2F%2Fmamaearth.com` | **"No verified ads found"**, `Verified ads 0` / `Related candidates 28`, broader-match opt-in offered |
| `/search?…&website=https%3A%2F%2Flenskart.com` | **21 verified ads**, every row an actual `Lenskart` ad |
| Home page flagship CTA | `href="/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com"` — carries `website=`, so the flagship path runs the v2 branch, not the legacy fallback |

So the customer outcome the item asked for is being served. The three domains
above are the mixed / all-noise / all-signal cases: nykaa 28→16, mamaearth
28→0 with an honest empty state, lenskart 21→21 with nothing removed.

### One thing the numbers do not say

`Eucerin India`, `Vaseline`, `Lancôme` and `La Roche-Posay` cards still appear
under a nykaa.com search. They are **not** the keyword junk the item flagged —
each one's landing page is a nykaa.com product page, and the detail pane states
"Landing page matches nykaa.com". That is `exact_hostname` /
`registrable_domain` evidence in `app/lib/search-domain-match.server.ts`, the
retailer case. The item's verify line (`grep -c -e Lancome …` → 0) therefore
reads as a miss while the acceptance behind it ("returns only advertisers
verified against nykaa.com, or labels any unverified card with its stated
reason") is met. The gap that remains is presentational: the result row shows
only the advertiser name, so the reason is one click away. Recorded as a named
follow-up in the audit; it is a separate change to a shared component
(`app/components/search/result-row.tsx`) and not a rollout-flag question.

## What this lane changed

### 1. `tests/search-rollout-config.test.ts` (new)

The flag sat at `"shadow"` from 2026-07-14 to 2026-08-12 — 29 days — and
nothing in the pre-merge suite noticed. The only rollout assertions lived in
`.github/workflows/uptime-health.yml` (post-deploy) and
`scripts/customer-readiness-candidate.mjs` (which no workflow runs). Four
assertions now read the committed configuration:

- `wrangler.jsonc` `SEARCH_ROLLOUT_MODE` is `v2`;
- `wrangler.e2e.jsonc` matches production, so the local release proof cannot
  drift from what ships;
- the committed value makes `shouldApplySearchV2` true and
  `shouldRunSearchV2Shadow` false;
- shadow/legacy/unset are pinned as filter-hiding modes, so an accidental
  deletion of the var fails too.

**Proven to fail on regression** — flipping `wrangler.jsonc` to `"shadow"`
locally:

```
× keeps the deployed Worker on the v2 rollout, never shadow or legacy
× keeps the local release-proof Worker on the same rollout as production
× applies the verified-advertiser filter for the committed production mode
AssertionError: expected 'shadow' to be 'v2'
Tests  3 failed | 1 passed (4)
```

`wrangler.jsonc` was restored immediately (`git diff --stat wrangler.jsonc` →
empty; this lane ships no config change).

### 2. `docs/search-relevance-audit.md`

The audit still said the shipped configuration was `shadow` and that "legacy
remains customer-visible", nine days after production began serving v2. The
documented rollback was `SEARCH_ROLLOUT_MODE=legacy` — following it during an
incident turns the verified-advertiser filter **off** instead of returning to
the shadow comparison step the same document prescribes.

- Current state stated at the top: `v2`, committed and deployed.
- Rollback now targets `shadow`, with `legacy` named as the deeper cut, plus
  the customer-visible cost of either (28 cards for nykaa.com, 13 of them other
  advertisers, unlabelled).
- Promotion record added with unfiltered-vs-verified counts for three real
  domains: nykaa.com 28/15/13 (captured production shadow telemetry,
  2026-08-12T05:17:14Z), mamaearth.com 28/0/28 and lenskart.com 21/21/0 (live
  answer-panel readings today).
- Each row is labelled as observed shadow telemetry or as a post-promotion
  reading. Further true shadow pairs cannot be collected — the shadow branch no
  longer executes in production, so an extra telemetry row would be invented,
  not observed. The table is not padded to hide that.
- Both regression guards are documented so a deliberate rollback has to edit
  the test in the same commit.

## Verification

- `vitest run tests/search-rollout-config.test.ts` → 4 passed.
- `vitest run` over the search and rollout suites —
  `search-rollout-config`, `search-execution`, `search.route`, `search-v2`,
  `search-answer`, `prod-canary`, `api.health.route`, `api.health.deep.route`,
  `customer-readiness-candidate` → **9 files, 129 tests, all passed**.
- `tsc -b` → 946 error lines on this branch and **the identical 946** on
  pristine `origin/main` content in this worktree; 0 of them name
  `search-rollout-config`. They are the absent generated
  `worker-configuration.d.ts` (`npm run cf-typegen`, which needs Cloudflare
  auth), not a regression from this change.
- Live checks above were run anonymously against `https://0509.io` with no
  credentials.

## Files

- `tests/search-rollout-config.test.ts` — new; pre-merge guard against the flag
  regressing out of `v2`.
- `docs/search-relevance-audit.md` — corrected stale rollout state and wrong
  rollback target; added the promotion record.
- `.lane/reports/0509-lane1-search-v2-promotion-record-20260821.md` — this
  record (lane-unique path; the shared `.lane/report.md` was not touched).

No file in `app/`, `workers/`, `scripts/`, `wrangler.jsonc`,
`wrangler.e2e.jsonc` or `.github/workflows/` was modified.
