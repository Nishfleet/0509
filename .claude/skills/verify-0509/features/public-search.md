# Public search — `/search`

The core feature, usable anonymously. Route: `app/routes/search.tsx`.

SSR GET with progressive streaming: the loader reads the query params and renders the
synchronous tier (cached/partial verified + likely rows) in the first response, then the
client revalidation poll appends the rest as the background capture completes. curl sees
the first-tier answer; a browser sees rows arrive in place as more land. The cold path
returns a typed warming state immediately and runs the browser capture in `waitUntil`,
writing a partial cache entry from the initial Ad Library surface so the first card lands
in seconds, not after the whole scroll (issues #951, #1471, #1482, #1858).

## How users reach it

Submit the hero form on `/`, follow `Try with Nykaa`, or open `/search` directly.

## How to drive it

1. `GET /search` — page `<h1 class="f9-wk-title">` reads `Find competitor ads`.
2. The command form is `<Form method="get">` with hidden `mode=advertiser` and
   `trackingRole=competitor`, one text input labelled `Competitor website`
   (`name="website"`, placeholder `https://competitor.com`), and the submit button `See ads`.
3. Optional filters sit behind a `<details>` whose `<summary>` reads `Refine search`; inside is
   `role="group" aria-label="Search filters"` with selects for country, platform, creativeType,
   status, firstSeenFrom, lastSeenFrom.
4. Submit a website, or request the URL directly: `/search?website=<domain>`.
5. Results render in `<section class="f9-results-panel">`, the list is
   `aria-label="Search results"`, rows are `.f9-wk-row` with `.f9-wk-rowlink`, and the evidence
   pane is `#selected-proof` (class `f9-proof-summary`). The top-ranked ad is selected on the
   server, so `#selected-proof` is present in the first SSR response; clicking a row adds
   `?selected=<metaAdId>` and moves focus into the pane. A `role="status"` live region
   announces the result count.

```bash
curl -fsS 'http://127.0.0.1:4179/search?website=not-a-domain' -o /tmp/verify-0509/search-invalid.html
grep -o 'data-f9-result-source="[^"]*"' /tmp/verify-0509/search-invalid.html
grep -c 'That website looks incomplete. Add the full domain, like brand.com.' /tmp/verify-0509/search-invalid.html
```

## What proves success

`.f9-results-panel` carries the machine-readable verdict — this is the canonical signal:
`data-f9-result-source`, `data-f9-result-cache-status`, `data-f9-result-empty-reason`.

Every row that carries a `domainMatch.level` renders exactly one tier badge:
`<span class="f9-tier-badge is-verified">Verified</span>` (green),
`<span class="f9-tier-badge is-likely">Likely</span>` (amber), or
`<span class="f9-tier-badge is-unmatched">Unmatched</span>` (grey). A likely row also gets a
one-click `Yes, that's them` trail link (`f9-wk-row-confirm`) that opens the ad's detail pane —
the confirmation is one click, not a dead-end. A `role="status"` `f9-tier-tail` line under the
rows names the split (`N verified · M likely · K unmatched — …`).

The progressive skeleton replaces the single `Searching…` spinner: when the page is warming
with rows already visible, a `f9-wk-progress` banner (`role="status"`, `aria-live="polite"`)
shows the count so far plus an honest `We'll refresh automatically as more ads come in.` line;
when warming with zero rows, a tier-progress row reads `N verified · still checking — Usually
under a minute — we'll refresh automatically.` The page never renders a bare empty state when
candidates exist — the three-tier model keeps every provider candidate as a labelled row
(verified / likely / unmatched), so a brand with 11–24 unverified candidates renders those rows
instead of `No verified ads found` (issue #1858 / BET 2).

Deterministic on a plain anonymous request:

- `/search?website=not-a-domain` → 200; `role="alert"` reading
  `That website looks incomplete. Add the full domain, like brand.com.`; the input carries
  `aria-invalid="true"`; section heading `Enter a competitor website`;
  `data-f9-result-source="demo"`, `data-f9-result-cache-status="none"`.
- `/search?website=nykaa.com` → 200, panel present, `data-f9-result-source="demo"` (the local
  server has no provider binding, and the page says so honestly). Rows carry
  `f9-tier-badge is-likely` and the `f9-wk-row-confirm` trail link; the `f9-tier-tail` line
  reads `0 verified · 1 likely · 0 unmatched — …`.

The seeded fixture states — `nykaa.com` (result link `Nykaa` / `Festive glow sale`,
`#selected-proof` headings `Nykaa` and `Festive glow sale`), `fresh-empty.example` (heading
`No verified ads found for fresh-empty.example`), `stale.example` (heading
`Search preview is temporarily unavailable`), all with
`data-f9-result-source="meta_library_browser"` — only appear through the release harness
(`npm run e2e:local:release`). Do not hand-forge the test-mode header to reach them.

Result headings come from `app/lib/search-display.ts` and `app/lib/search-answer.ts`; a market
scope is appended when the search names a country (`… across all countries` for the
all-countries view). The production suite asserts `1 verified ad linked to nykaa.com` against
`https://0509.io`, not against the local server.

## Streaming canary

`npm run canary:search-stream` (`scripts/search-stream-canary.mjs`) hits the 25 mixed BET 2
domains and asserts the streaming contract from issue #1858:
`p95_first_card_ms < 5000`, `dead_end_count = 0`, `verified_share >= 0.8`. It reuses the
`bet2-live-verification.mjs` probe machinery verbatim (streamed-body first-card detection,
warming poll loop, rate limiter). Exits non-zero when any streaming check trips. Defaults to
`https://0509.io`; pass `--base-url` to point it elsewhere. Unit tests in
`tests/search-stream-guard.test.ts` cover the verdict logic with mock fetch.

## Signed-in extras on the same route

`/search` also serves POST intents that require a session (`save-query`, `create-watchlist`).
A successful watchlist save redirects to `/app/watchlists?watchlist=<id>`. Anonymous drives
cannot reach these.
