# Lane evidence — claim/issue-3391 (visitor: TTFB jump on 2nd consecutive-read — search 1484→2135ms, home 86→329ms; all hard visitor fields green)

## The watch, and that it fired — receipts

The issue's verbatim: "if the 19:00Z read is also >1500ms search, probe TTFB by
route (cache HIT variance vs origin) and fix; single-read deltas are
noise-prone." The reads after 18:01Z stayed >1500ms, so it fired:

- 17:43Z (judge, in the issue): home_ttfb_ms=86 search_ttfb_ms=1484
- 18:01Z (measure): home_ttfb_ms=329 search_ttfb_ms=2135
- 20:43Z (judge, `last-fable-status.md`): "Search TTFB jumped 1757 -> 6269 vs
  last run; #3391 already open" — 6269ms, 4.2× the 1500ms watch line
- 21:01-21:02Z (this lane, 6 spaced reads, `curl -D`), same VPS vantage as the
  judge — my 6268ms read reproduces the judge's 6269ms:

| read | route | ttfb_ms | total_ms | colo | cf-cache | placement |
|---|---|---|---|---|---|---|
| 21:01:57Z | / | 332 | 439 | a3aa | **HIT** | remote-NRT |
| 21:01:59Z | /search?q=calendly.com | 6239 | 6268 | a3aa | — (no header) | **local-** |
| 21:02:07Z | / | 635 | 874 | a3aa | HIT | remote-NRT |
| 21:02:10Z | /search?q=calendly.com | 5764 | 5794 | a3aa | — | **local-** |
| 21:02:18Z | / | 316 | 562 | a3aa | HIT | remote-NRT |
| 21:02:21Z | /search?q=calendly.com | 1856 | 2170 | a3aa | — | remote-NRT |

By route, the discrimination the watch asked for: `/` = edge HIT every read,
316-635ms (`public, s-maxage=3900, max-age=300` — the #2950/#3308 contract);
`/search` = **no cf-cache-status at all** (`no-store, no-cache, must-revalidate`
+ the #1972 `set-cookie`) → 100% of reads paid origin, 1856-6268ms, bimodal by
smart placement — the #3319 signature (fast = `remote-NRT` placed isolate,
slow = `local-` isolate paying isolate↔D1 inter-region round-trips).

## Root cause (this unit's investigation, receipts on file)

- Not today's merges: everything merged after 17:40Z (`git log --since
  2026-09-13T17:40Z`) is the mentions/coverage family (#3197-#3204, #3373) —
  no search route, no SSR, no middleware.
- And not deployed anyway: the judge's 20:43Z line has
  `last_green_deploy=NONE-in-100` (99h, 427 merges) — prod runs PRE-#3319
  code, so #3319's origin-side fix (bounded waves, waitUntil telemetry,
  identity prewarm — all merged, all gated green in #3394) cannot show yet.
  The 6269ms is the #3319 placement bimodality, still live in prod.
- The cache-HIT-vs-origin half is the NEW, unshipped half: `/search` was never
  in `PUBLIC_CACHEABLE_HTML_PATHS` (the #2950 Set: `/`, `/pricing`, the #3193
  marketing families — no `/search`), and even if listed, its document failed
  BOTH `isEdgeCacheableHtmlResponse` clauses at once: `no-store` (the
  security-headers default for non-allowlisted HTML) and the #1972
  `set-cookie`. So every anonymous search read — judge, measure, AEO crawler,
  first-touch human — paid full origin, while home paid ~300ms.

## What shipped (this PR)

`/search` joins the existing #2950 anonymous public-HTML edge cache — no new
mechanism, one new allowlist entry, one marker header, one guard:

1. `workers/security-headers.ts` — `"/search"` joins
   `PUBLIC_CACHEABLE_HTML_PATHS`. ONE Set feeds BOTH the `public,
   s-maxage=3900, max-age=300` stamp (withSecurityHeaders) and the
   edge-eligibility gate (`cacheablePathname`), so the #3193 "keep the gates in
   agreement" rule stays true by construction. `cacheKeyUrl` already preserves
   the query, so `?q=calendly.com` and `?website=hubspot.com` are distinct
   (path+query, country, version) keys.
2. `workers/edge-cache.ts` + `workers/app.ts` — `EDGE_CACHE_ELIGIBLE_HEADER`
   (`x-0509-edge-cache-eligible`): renderAndStore marks the router request it
   renders whenever the edge cache will own the stored variant. One truth (the
   #2950 predicate); the loader reads a marker, it does not re-derive
   eligibility (no worker→app imports exist; the wiring test couples them).
3. `app/routes/search.tsx` — the #1972 fresh-anon mint is suppressed ONLY on
   marked renders, so the stored copy stays cookie-free
   (`isEdgeCacheableHtmlResponse` deletes set-cookie, but its gate runs FIRST
   and rejects any response carrying one — without this, /search would never
   store). The semantics survive #1972 intact: a cookieless read has no
   per-browser identity to persist; the IP backstop (`RL_SEARCH_IP`,
   keyByIpOnly) still limits it; the BET-2 funnel polls `/search.data`, whose
   pathname never rides the gates, so the poll still mints the cookie and the
   visitor's per-browser budget persists; and the first cold post-deploy read
   mints it again. Signed-in/cookie-bearing reads keep today's behavior
   exactly (the cookie request-gate already excluded them).

Freshness = the #2950 arithmetic, unchanged: TTL = the stamped max-age (300)
capped at EDGE_TTL_CAP_SECONDS, plus the #3247 serve-stale window (3600s) with
a waitUntil background re-render — the judge's HOURLY probe lands warm-or-
stale-refresh, the exact #3308 lesson ("probe-only traffic alternates
MISS/HIT forever" without it).

## What this does NOT do (deliberate, in-scope)

- Localized twins (`/de/search`, `/fr/search.data?…`) keep today's no-store —
  exactly the #3193 precedent (bare paths only). Same for the legacy
  `?_data=`-style polls.
- No `migrations/**` change, no wrangler/zone config (the #2950 comment's
  finding: the zone does not store Worker HTML without a Cache Rule, which is
  why the Worker-side Cache API exists), no placement change, no #3319 redo.
- The LIVE HIT proof is a deploy-gate fact, not a code fact: it lands with the
  next green Deploy Worker (#2897, 99h no-green, 2 runs in flight at 20:46Z).
  The judge's next post-deploy `visitor:` line is the measured witness — this
  lane proves the mechanism at both test layers instead of pretending.

## Verification (final head, this lane)

- Affected node pass: `npx vitest run --configLoader runner --project node
  --changed origin/main` → **39 files / 358 tests, exit 0** (round 1 failed
  ERR_MODULE_NOT_FOUND — fresh worktree, no node_modules; `npm ci` fixed it;
  round 2 failed the stale #2950 eligibility pin expecting
  `isEdgeCacheableHtmlRequest(/search) === false`; the pin was updated to the
  new world with a personalised-`/status` guard; round 3 green).
- New coverage, both layers: `tests/worker-edge-cache-wiring.test.ts` proves
  the /search case END TO END through the real worker fetch handler (MISS →
  stored variant cookie-free → HIT with the router never re-rendered →
  `?q=`-distinct keys → `/search.data` unstamped and still minting);
  `tests/search.route.test.ts` pins the marked-render mint suppression; the
  #2950 unit eligibility and the security-headers coupling tests now witness
  `/search?q=calendly.com` (public stamp) vs `/search.data` (no-store).
- `sgscan --base origin/main` → "No new security findings.", exit 0.
- One suite at a time, `VITEST_MAX_WORKERS=2` respected, no coverage, no
  typecheck, no `--maxWorkers` (CI owns the last two).

net-positive-because: the diff is one allowlist path, one marker header, one
guard — it JOINS the shipped #2950 rail instead of adding a mechanism; every
added line closes a named clause of the watch (probe: the discrimination
receipts; fix: the HIT side) or pins it.
