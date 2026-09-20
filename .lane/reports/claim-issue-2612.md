# Lane evidence: claim/issue-2612

Issue: Nishfleet/0509#2612 — "establish verified GOAT Meta Page id to restore
goat.com recall (follow-up to #2233)". The issue recorded a 2026-09-10 probe
that read the curated id `746493592053334` as "The GOAT" mouth-tape brand
(thegoatco.au) and saw a single unmatched mouth-tape ad under goat.com.

Finding: the curated id was never wrong. Re-verified live 2026-09-20 via the
netcup browser-harness Chrome (CDP 127.0.0.1:9333) against the real Meta Ad
Library UI:

- Advertiser typeahead for "GOAT" pairs `746493592053334` with display name
  GOAT / page_alias `goatapp` (BLUE_VERIFIED, ~257K page likes, ~3.6M
  Instagram followers).
- `view_all_page_id=746493592053334` (country=all, active_status=all,
  search_type=page, is_targeted_country=false) returns ~69 ads; every card
  shows a GOAT.COM landing host, 282 goat.com hits in rendered content, 30
  unique ad_archive_ids in the visible set.
- The mouth-tape page is a DIFFERENT id: `222826840917934` "The GOAT"
  (thegoatco.au) — it has no goat.com ads.
- `100064558275258` is goatapp's new-experience profile id (fb://profile
  target); it returns 0 library ads and must never be substituted.

Root cause of the Sep-10 misread: consistent with the v2 domain cache key
omitting the result filters, so a differently-filtered writer could poison the
goat.com entry — fixed next day by 08ae3be9b ("key the domain cache on the
result filters", merged Sep 11). Proven: the #1982 curated id + tests were
already correct (live typeahead pairing and page-scoped ads all landing on
goat.com); the exact poisoning path is inferred, not demonstrated end-to-end.

Production state (already green before this diff):

- `GET https://0509.io/search?website=goat.com` → HTTP 200, 38 verified +
  3 likely + 3 unmatched rows in state; 30 rendered `Verified` tier badges,
  URLs landing on goat.com product/apparel paths (incl. /fr-fr, /en-gb).
- `GET https://0509.io/ads/goat.com` → HTTP 200, real brand page.
- Scheduled sneaker-resale canary (agent-state worktree, resets to
  origin/main each run): `goat.com status=200 rows=30 30 verified /
  0 likely / 0 unmatched`; overall PASS. goat.com is absent from
  KNOWN_IDENTITY_GAPS.

Change:

- `app/lib/website-identity.server.ts` — comment only: records the
  2026-09-20 live re-verification and disambiguates the three look-alike ids
  so a future fixer cannot swap in the profile id (0 ads) or the mouth-tape
  page. No runtime code touched; existing tests already pin the id
  (website-identity.server, search-v2, sitemap parity).

Verification:

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 384 files / 4720 tests pass, 42.85s.
- `semgrep --config p/default --baseline-commit "$(git merge-base HEAD
  origin/main)" --quiet --metrics=off` → clean, exit 0.
- Live evidence above captured against production 0509.io and the real Meta
  Ad Library on 2026-09-20.
