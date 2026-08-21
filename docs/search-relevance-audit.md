# Search Relevance Audit (updated 2026-08-21)

**Current state:** search v2 is promoted. The committed Worker configuration is
`SEARCH_ROLLOUT_MODE: "v2"` in both `wrangler.jsonc` and `wrangler.e2e.jsonc`,
and production serves it — every website-scoped public search returns the
verified set, not the raw provider list. See [Promotion record](#promotion-record-shadow--v2)
for the shadow-versus-v2 evidence the promotion was based on.

## Current candidate pipeline

1. `/search` loader reads `website` query param.
2. Search V2 parses a domain intent and derives a brand-sized discovery query (`nykaa.com` → `nykaa`) because Meta Ad Library does not provide native domain search.
3. Exact scope independently verifies candidates from landing-page, advertiser-domain, or resolved entity evidence before rendering them as connected to the website.
4. Broader scope can include unverified provider/text candidates, but verified and related counts and reasons remain separate.
5. Selected proof renders before the result list with source, cache freshness, capture status, match reason, and deterministic focus behavior.
6. Authenticated selections persist only server-canonical public Meta evidence; external proof cannot be recovered through the global ad lookup.

## Reproduced failure (`okara.ai`)

- Input: `https://okara.ai`
- Derived query: `okara` (hostname stem)
- Provider: Meta Ad Library exact phrase search for `okara`
- Unrelated match: **ESHAL HOMEOPATHIC CLINIC OKARA** (geography/ad-copy keyword match on “Okara”, not `okara.ai`)

## Root cause

Domain website searches were degraded to unrestricted keyword search on the first hostname label (`okara.ai` → `okara`) with no post-filter against landing/advertiser domains.

Key files:

- `app/lib/competitor-website.ts` — stem extraction (`inferSearchTermFromHost`)
- `app/lib/competitor-website.ts` — `applyWebsiteSearchFallback`
- `app/lib/meta-library-browser.server.ts` — `buildSearchUrl` uses keyword search
- `app/routes/search.tsx` — no verified-domain empty state or broader opt-in

## Implemented correction (search v2 candidate)

1. **Query intent** — PSL-aware parser distinguishes `domain` vs `text` (`app/lib/search-query.ts`).
2. **Provider query** — domain intent uses the brand label for discovery (`okara.ai` → `okara`), then verifies the registrable domain after retrieval.
3. **Verified matching** — post-filter levels 1–5 only for exact results (`app/lib/search-domain-match.server.ts`).
4. **Broader opt-in** — stem/keyword candidates (level 6) only when `?broader=1`.
5. **Cache isolation** — `search-v2:domain:<domain>:<scope>:...` keys (`app/lib/search-v2.server.ts`).
6. **Identity resolution** — optional SSRF-safe homepage fetch (`app/lib/website-identity.server.ts`).
7. **Rollout** — the committed Worker configuration is `v2`: the post-filter's verified set is what the visitor receives. Plaintext competitor domains are not logged.

## Rollout and rollback

- **Deploy order (completed):** migration `0054_search_domain_identity_cache.sql` applied, Worker deployed with `SEARCH_ROLLOUT_MODE=shadow` on 2026-07-14, live comparison observed from production shadow telemetry, then promoted to `v2` in a separate configuration change (PR #685, `70faea05`, merged 2026-08-12; first production Worker actually serving `v2` observed 2026-08-13).
- **Rollback:** set `SEARCH_ROLLOUT_MODE=shadow` and redeploy. Shadow keeps the v2 comparison telemetry flowing while the visitor sees the legacy provider result, so the same evidence that justified the promotion keeps accruing during the incident. Use `legacy` only to stop the v2 pipeline entirely (no post-filter, no comparison telemetry, stem-fallback behaviour restored) — it is the deeper cut, not the default.
- **Rollback cost:** shadow and legacy both return the unfiltered provider list to customers. On the reference domain that means 28 result cards for `nykaa.com` of which 13 belong to other advertisers, unlabelled. Treat a rollback as customer-visible, not as a neutral flag flip.
- **Regression guard:** `tests/search-rollout-config.test.ts` asserts the committed `SEARCH_ROLLOUT_MODE` is `v2` in both wrangler configs, so a change back to shadow or legacy fails in `npm test` before merge. Post-deploy, `.github/workflows/uptime-health.yml` re-checks `releaseIdentity.searchRolloutMode` on `/api/health` and `/api/health/deep`. A deliberate rollback therefore edits the test in the same commit — the flag cannot move silently again.

## Promotion record (shadow → v2)

The 2026-07-14 shadow deployment was intended as a short comparison window. It
ran for 29 days instead, during which every website-scoped public search
computed the verified set and threw it away. This record exists so the
promotion is evidence-backed and so the failure mode is written down.

### Unfiltered-versus-verified comparison

Shadow emitted one aggregate line per website-scoped search
(`kind: "search_v2_shadow"`, `app/lib/search-execution.server.ts`), carrying the
legacy count actually served and the v2 counts computed and discarded. Plaintext
competitor domains are deliberately absent from that line, so each row below is
keyed to the search that was in flight when the sample was taken. Post-promotion
the same two numbers are readable from the answer panel, which reports the
verified count and the related-candidate count side by side.

| Domain | Unfiltered candidates | Verified by v2 | Rejected as keyword-only / unverified | Source |
| --- | ---: | ---: | ---: | --- |
| `nykaa.com` | 28 | 15 | 13 | production shadow telemetry, 2026-08-12T05:17:14Z |
| `mamaearth.com` | 28 | 0 | 28 | live answer panel, 2026-08-21 (`Verified ads 0` / `Related candidates 28`) |
| `lenskart.com` | 21 | 21 | 0 | live answer panel, 2026-08-21 (`Verified ads 21 — Connected to this domain`) |
| `okara.ai` | ≥1 | 0 | ≥1 | reproduced failure above (`ESHAL HOMEOPATHIC CLINIC OKARA` on an `okara.ai` search) |

Read together these three domains cover the range the filter has to handle:

- **`nykaa.com` — mixed.** 46% of what shadow served (13 of 28) was a
  keyword-only match that v2 had already identified and rejected.
- **`mamaearth.com` — all noise.** Every one of the 28 candidates fails
  verification. Legacy would have presented all 28 as this competitor's ads;
  v2 says "No verified ads found" and offers the 28 under
  "Related candidates — available to review separately without a verified
  website claim".
- **`lenskart.com` — all signal.** All 21 candidates verify, so the filter
  removes nothing. This is the control case that shows the post-filter is not
  simply suppressing results.

Provenance and honesty note: the `nykaa.com` row is the one captured production
shadow line —
`{"kind":"search_v2_shadow","mode":"shadow","legacyCount":28,"v2VerifiedCount":15,"v2RejectedKeywordOnlyCount":13,"ts":"2026-08-12T05:17:14.045Z"}`
— taken from `wrangler tail 0509 --format json` while fetching
`/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com`. The
`mamaearth.com` and `lenskart.com` rows are **post-promotion** measurements: the
answer panel reports verified and related counts side by side, which is the same
comparison shadow used to log. Further true shadow-mode pairs cannot be
collected retroactively — the shadow branch no longer executes in production, so
any additional telemetry row would be invented rather than observed.

### Post-promotion verification (live, 2026-08-21)

- `curl -s https://0509.io/api/health` →
  `{"status":"ok","app":"0509","releaseIdentity":{"workerVersionId":"0097fc57-c27d-4097-88dc-0862ede8d683","searchRolloutMode":"v2", ...}}`
- `GET /search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com`
  (anonymous, HTTP 200) renders **"16 verified ads linked to nykaa.com across
  all countries"** under the heading "Verified ads linked to nykaa.com" — the
  filtered set, where shadow served 28 unfiltered cards.
- The keyword-only cards the shadow line counted are gone. The 2026-08-12
  capture of this URL contained `Maybelline New York` and `Indulekha`, whose
  ads merely mention "…at best prices on Nykaa"; the 2026-08-21 capture contains
  neither (`grep -c -i maybelline` → 0, `grep -c -i indulekha` → 0).
- `GET …&website=https%3A%2F%2Fmamaearth.com` returns **"No verified ads found
  for mamaearth.com"** with `Verified ads 0` / `Related candidates 28` and an
  explicit "Search broader matches" opt-in — the honest zero-verified outcome
  this audit called for, instead of 28 unlabelled cards.
- `GET …&website=https%3A%2F%2Flenskart.com` returns **21 verified ads**, every
  row an actual `Lenskart` ad — the filter costs a clean domain nothing.
- Every remaining card carries verified evidence rather than a keyword match.
  Ads from other brands still appear on `nykaa.com` — `Eucerin India`,
  `Vaseline`, `Lancôme`, `La Roche-Posay` — because their landing page **is** a
  nykaa.com product page. Their detail pane states the reason: "Landing page
  matches nykaa.com" (`exact_hostname` / `registrable_domain` in
  `app/lib/search-domain-match.server.ts`). That is the retailer case, not the
  keyword-junk case the post-filter removes.
- `kind: "search_v2_shadow"` no longer fires: with `resolveSearchRolloutMode`
  returning `v2`, `shouldRunSearchV2Shadow` is false and the comparison branch
  in `executeSearchWithRelevance` is never entered.

### Known limitation this record does not close

For a retailer domain, a landing-page match answers "this ad sells on
nykaa.com", not "Nykaa ran this ad". Both are verified evidence and both are
legitimate answers to "who advertises against this website", but the result row
(`app/components/search/result-row.tsx`) shows only the advertiser name — the
match reason lives one click away in the detail pane. A visitor scanning the
list therefore still sees "Lancôme" under a nykaa.com search with no inline
explanation. Surfacing `domainMatch.customerReason` on the row is a separate
change; it is not a rollout-flag question and does not affect the promotion.

## Provider limitations

Meta Ad Library has no native domain-indexed search. Five to Nine must query broadly enough to discover candidates, then verify via landing/advertiser domains. Zero verified results is an honest outcome.
