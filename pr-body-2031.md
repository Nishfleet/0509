## seo: sitemap.xml ships no lastmod on any of its 86 URLs — Google re-crawls blind (BET 5 / direction)

Closes #2031.

### What changed

Every sitemap URL now carries a `<lastmod>` drawn at sitemap-render time from real content data — never the build clock:

- **Static funnel URLs** (~29 entries): `LATEST_CHANGELOG_ENTRY_DATE` — the changelog's latest entry date, the app's own record of when customer-visible content last changed. It is maintained by hand with each changelog release and guarded by a drift-detector test that parses the newest `title="YYYY-MM-DD"` block out of `app/routes/changelog.tsx` and asserts the constant equals it.
- **`/brands`**: overridden with the newest `/ads/:domain` capture's `fetched_at` (the same freshness field the dynamic brand entries already carry) — when the brand cohort goes stale, the hub's lastmod goes stale with it, honestly.
- **Dynamic `/ads/:domain` and `/timeline/:domain`**: unchanged — these already carried capture-derived lastmod.
- **No-DB fallback sitemap** (`SITEMAP_XML` in `app/lib/seo.ts`) now carries the same content lastmod.

`renderSitemapXml` funnels every lastmod through a new `normalizeSitemapLastmod` guard: only W3C datetime dates (`YYYY-MM-DD`, real calendar dates) are emitted; malformed values degrade to omitting the element rather than shipping a timestamp crawlers can't parse. A stale page never claims freshness newer than its data.

### Verification

Real run results from this branch:

- `tests/sitemap-static-lastmod.test.ts` (new): **7/7 passed** — covers the acceptance exactly:
  - every URL (static + `/ads` + `/timeline`) in `buildSitemapXml` output carries a `<lastmod>`, and the count equals the `<loc>` count (verified in tests, 32 locs → 32 lastmods on the fixture set);
  - a known-stale domain's (6-day-old capture) lastmod is older than a fresh one's (2-day-old capture);
  - every emitted lastmod matches `YYYY-MM-DD` and survives `normalizeSitemapLastmod`;
  - `normalizeSitemapLastmod` rejects malformed/impossible dates (`2026-02-31`, ISO-timestamps, garbage);
  - drift detector: `LATEST_CHANGELOG_ENTRY_DATE === newest changelog entry title`;
  - `/brands` tracks its newest capture while `/changelog` keeps the content date.
- Full suite: **627 files / 7464 tests passed** (`vitest run --project node`), **41 files / 202 tests passed** (`--project workers`), `tsc --noEmit` clean, sgscan clean (no new security findings).
- Post-deploy termination check (from the issue): `curl -sS https://0509.io/sitemap.xml | grep -c '<lastmod>'` — expected == URL count (≥ 86). Before this PR the live sitemap had 87 `<loc>` / 58 `<lastmod>` (dynamic entries only); this PR closes the remaining 29 static URLs.

run-proof: worker run pi-issue-0509-2031 — sitemap test files 4 passed (92 tests: sitemap-static-lastmod, sitemap.server, sitemap-noindex-parity, locale-sitemap), full node project 627/7464, workers project 41/202, tsc 0 errors, sgscan 0 findings (worktree /home/nish/workspaces/agent-worktrees/issue-0509-2031, branch claim/issue-2031).

net-positive-because: the ~205 added lines are one acceptance-test file (tests/sitemap-static-lastmod.test.ts, the issue's required test) plus the render-time lastmod attach + W3C guard they assert; the sitemap gains a lastmod element on every static URL without changing any <loc>, changefreq, or priority value.

loose-ends: post-deploy lastmod count check is the issue's own termination command and runs after merge; the changelog constant moves with each changelog release (drift-detector test fails loudly if forgotten).


### Test plan

- [x] `npx vitest run --configLoader runner --project node tests/sitemap-static-lastmod.test.ts`
- [x] `npx vitest run --configLoader runner --project node` (627 files, 7464 tests)
- [x] `npx vitest run --configLoader runner --project workers` (41 files, 202 tests)
- [x] `npx tsc --noEmit`
- [x] `sgscan`
