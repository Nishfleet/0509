# Worker handoff — Nishfleet/0509 #2194 (TikTok Ads source)

Worktree: `/home/nish/workspaces/agent-worktrees/0509-2194` (branch `claim/issue-2194`).
You implement the TikTok Ads competitor-monitoring source. Read this whole
packet before touching anything. Implement ALL phases. Bar is "extremely well".

## The issue (binding)

TikTok's Commercial Content Library (library.tiktok.com, EU DSA transparency)
has no public API. The rendered web page works through Decodo universal with JS
rendering. We scrape it via Decodo, weekly per competitor, capped at 800 JS
requests/month by the Decodo budget counter.

### Verified Decodo request
`POST https://scraper-api.decodo.com/v2/scrape`, `Authorization: Basic
$DECODO_SCRAPER_AUTH`, body:
```json
{"target":"universal","url":"https://library.tiktok.com/ads?region=all&start_time=1735689600000&end_time=<now ms>&adv_name=<term>&query_type=<1|2>&sort_type=last_shown_date,desc","headless":"html","proxy_pool":"standard","geo":"Germany"}
```
- `query_type=1` = keyword match over ad text + advertiser (fuzzy).
- `query_type=2` = exact advertiser legal name.
- `end_time` = current time in milliseconds.
- Response JSON has the rendered HTML somewhere (Decodo `universal` + `headless:"html"` returns `{ ... "content": { "html": "<rendered html>" } }` — but DO NOT assume the exact shape; parse defensively: look for an `html` string under `content` or at top level, fall back to stringifying. The fixtures you write define the shape you parse; make the parser tolerant).

### Rendered text pattern (what the HTML contains)
- Per card: `Ad <advertiser> First shown: MM/DD/YYYY Last shown: MM/DD/YYYY Unique users seen: <n or ->`
- Detail links: `/ads/detail/?ad_id=<digits>` (href on an `<a>` inside the card)
- Header: `Total ads: <n>`
- 12 cards per render (newest by last shown first). Pagination is scroll-driven; NOT needed — newest 12 is enough.
- Creative thumbnail: if an `<img>` is present in the card, capture its `src`.

### do:1 — tiktok-ad-library.server.ts
`app/lib/sources/tiktok-ads/tiktok-ad-library.server.ts` (NEW):
- `resolveAdvertiser(env, competitorName)`: ONE query_type=1 render. Collect distinct advertiser names from cards whose normalized form contains the competitor's normalized name. Pick the candidate with the most cards on the resolve render (tie: first in card order). Return `{ legalName, candidates: string[] }` or `{ unavailable: true, reason }`. If no card's advertiser contains the competitor name → `{ unavailable: true, reason: "no_match" }`.
- `fetchAds(env, legalName)`: ONE query_type=2 render. Parse the 12 cards (ad id from the detail link, advertiser, first shown, last shown, unique users, creative thumbnail if present). Return `{ ads: TiktokAd[], totalAds: number }` or `{ unavailable: true, reason }`. Unavailable when: Decodo 613, non-200, OR zero cards with no "Total ads" header (parse break, NOT "no ads"). If "Total ads: 0" header present with zero cards → that is a real zero: return `{ ads: [], totalAds: 0 }` (NOT unavailable). ONE attempt, 90s timeout.
- A `renderTiktokLibrary(env, { queryType, advName, now })` helper that: (a) calls `reserveDecodoBudget(env, "js")` BEFORE the request; on deny returns `{ unavailable: true, reason: "quota" }` WITHOUT making the request; (b) POSTs to Decodo; (c) 90s timeout, one attempt; (d) on non-200 returns `{ unavailable: true, reason: "decodo_error", status }`; on 613 returns `{ unavailable: true, reason: "quota" }`; (e) returns `{ html }` on success.
- A `parseTiktokLibraryHtml(html)` pure function: extracts `totalAds` (from `Total ads: <n>`) and the card list. Each card: `{ adId, advertiser, firstShown, lastShown, uniqueUsers, thumbnail }`. adId from the `ad_id=<digits>` in the detail link. Dates as MM/DD/YYYY strings (keep as strings; also store an ISO-ish sortable form if convenient). This parser is pure and unit-testable from fixtures.
- Normalize names: lowercase, trim, collapse whitespace, strip punctuation for the "contains" match.

`TiktokAd` shape (export it):
```ts
export interface TiktokAd {
  adId: string;
  advertiser: string;
  firstShown: string; // MM/DD/YYYY
  lastShown: string;  // MM/DD/YYYY
  uniqueUsers: string; // the raw text ("12345" or "-")
  thumbnail: string | null;
}
```

### do:2 — tiktok-ads-snapshot.server.ts
`app/lib/sources/tiktok-ads/tiktok-ads-snapshot.server.ts` (NEW):
- `fetchTiktokSnapshot(env, competitor): Promise<SourceFetchResult>` — the adapter's fetch body. Steps:
  1. If no `DECODO_SCRAPER_AUTH` → `{ unavailable: true, reason: "not_configured" }`.
  2. 7-day gate: read the latest `source_snapshot` row for `(competitor.competitorId, "tiktok")` (use `getLatestSourceSnapshot` exported from `~/lib/sources/run.server` — it is a public export; consume it, do NOT edit run.server). If it exists and its `fetchedAt` is less than 7 days before now → `{ unavailable: true, reason: "cadence" }` (skip this check; weekly).
  3. Read `competitor.tiktok_advertiser` from D1: `ensureDb(env).prepare("SELECT tiktok_advertiser FROM watchlist WHERE id = ?").bind(competitor.competitorId).first<{ tiktok_advertiser: string | null }>()`. (`ensureDb` from `~/lib/data/d1.server`; `AppEnv` from `~/lib/env.server`.) Cast `env` to `AppEnv` inside this module.
  4. If no stored name: `resolveAdvertiser(env, competitor.competitorLabel)`. If unavailable → return it. If `no_match` → return `{ unavailable: true, reason: "no_advertiser" }`. Else `fetchAds(env, legalName)`. If unavailable → return it. Return `{ payload: { ads, totalAds, legalName, candidates, resolvedAt: nowIso() }, competitorUpdate: { tiktok_advertiser: legalName } }`.
  5. If stored name: `fetchAds(env, storedName)`. If unavailable → return it. If `totalAds === 0` (real zero) → re-resolve: `resolveAdvertiser(env, competitor.competitorLabel)`; if a new legalName found, `fetchAds(env, newLegalName)` and return `{ payload: ..., competitorUpdate: { tiktok_advertiser: newLegalName } }`; if no_match, return the empty result `{ payload: { ads: [], totalAds: 0, legalName: storedName } }`. If ads present → return `{ payload: { ads, totalAds, legalName: storedName } }`.
  - `nowIso` from `~/lib/data/helpers.server`.
  - The payload is a `JsonRecord` (Record<string, unknown>).
- `diffTiktokAds(prev, next): SourceChange[]`:
  - `prev` is `SourceSnapshotRecord | null`; `next` is `SourceSnapshotInput` (has `.payload`). Both payloads have `{ ads: TiktokAd[], totalAds: number, legalName: string }`.
  - New ad ids (in next, not in prev by adId) → `{ eventType: "ad_new", title: "New TikTok ad from <legalName>", summary: "Ad <adId> first shown <firstShown>, last shown <lastShown>.", metadata: { sourceId: "tiktok", adId, advertiser } }`.
  - Paused: an ad present in both prev and next whose `lastShown` is identical in both AND `now - lastShown >= 14 days` → `{ eventType: "ad_inactive", title: "TikTok ad paused", summary: "Ad <adId> (<advertiser>) last shown <lastShown> — inactive 14+ days.", metadata: { sourceId: "tiktok", adId, advertiser, lastShown } }`. Use `new Date()` as now; parse MM/DD/YYYY to a Date for the 14-day check.
  - Total-ads change: if `prev.totalAds !== next.totalAds` → `{ eventType: next.totalAds > (prev?.totalAds ?? 0) ? "ad_new" : "ad_inactive", title: "TikTok total ads changed", summary: "Total EU-shown ads: <prev> → <next>.", metadata: { sourceId: "tiktok", totalAdsBefore: prev?.totalAds ?? 0, totalAdsAfter: next.totalAds } }`.
  - If prev is null (first snapshot), emit only the new-ad entries (no paused, no total change).
  - `SourceChange`, `SourceSnapshotRecord`, `SourceSnapshotInput`, `SourceFetchResult`, `SourceFetchContext` from `~/lib/sources/types`. `WatchEventType` literals: `"ad_new"`, `"ad_inactive"` (from `~/lib/types`).

### do:3 — tiktok-ads.tsx Section
`app/components/sources/tiktok-ads.tsx` (REPLACE stub):
- Props: `{ snapshot: SourceSnapshotRecord | null; diff: SourceChange[] }`.
- If `snapshot` is null → return null (the seam does not pass snapshots to SourceSections yet; #2188 wires that. Render nothing when there is no data).
- If `snapshot.payload` has ads (or totalAds): render a `<section aria-label="TikTok ads (EU-shown)">`:
  - `<p className="f9-evidence-micro">TikTok ads — EU-shown only</p>`
  - Legal advertiser name (`payload.legalName`), total ads (`payload.totalAds`).
  - Newest 12 ads: each as a line with advertiser, first shown, last shown, unique users, and a `<Link to="https://library.tiktok.com/ads/detail/?ad_id=<id>" rel="noopener noreferrer" target="_blank">View ad</Link>`. Use `react-router` `Link` (external absolute URL is fine via `to`). Actually for external links use a plain `<a href=...>` — `Link` is for internal routes. Use `<a>`.
  - Label clearly "EU-shown ads only" (the section micro-label already says it; also add a one-line note).
  - If `totalAds === 0` and no ads: render "No EU-shown TikTok ads found for <legalName>."
  - Use existing CSS classes from `app/app.css`: `f9-evidence-micro`, `f9-wk-dim`, `f9-wk-mt`, `f9-detail-split`/`f9-detail-cell` for the ad grid, `f9-wk-lnk` for links. Match the style of `app/components/watchlists/recent-checks-section.tsx` (section + micro label + list). Keep it simple and pure-CSS.
- This component is client-safe: import only types, no `.server.ts` imports.

### Adapter — tiktok-ads.server.ts
`app/lib/sources/tiktok-ads.server.ts` (REPLACE stub):
```ts
import type { SourceAdapter, SourceChange, SourceFetchContext, SourceFetchResult, SourceSnapshotInput, SourceSnapshotRecord } from "~/lib/sources/types";
import type { AppEnv } from "~/lib/env.server";
import { TiktokAdsSection } from "~/components/sources/tiktok-ads";
import { fetchTiktokSnapshot, diffTiktokAds } from "~/lib/sources/tiktok-ads/tiktok-ads-snapshot.server";

export const tiktokAdsAdapter: SourceAdapter = {
  id: "tiktok",
  label: "TikTok Ads (Commercial Content Library, EU-shown)",
  kind: "ads",
  implemented: true,
  cadence: "weekly",
  requiresEnv: (env: unknown) => Boolean((env as AppEnv)?.DECODO_SCRAPER_AUTH),
  async fetch(env: unknown, competitor: SourceFetchContext): Promise<SourceFetchResult> {
    return fetchTiktokSnapshot(env as AppEnv, competitor);
  },
  diff(prev: SourceSnapshotRecord | null, next: SourceSnapshotInput): SourceChange[] {
    return diffTiktokAds(prev, next);
  },
  Section: TiktokAdsSection,
};
```

### do:5 — Tests + fixtures
Fixtures under `tests/fixtures/tiktok-ad-library/` (synthetic HTML matching the
rendered pattern — you cannot call Decodo, no secret):
- `resolve-keyword.html` — query_type=1 render. Multiple advertisers; e.g. cards for "New Balance" (3 cards) and "Notion" (2 cards) and unrelated "Nike" (7 cards). `Total ads: 141`. 12 cards. Used to test resolveAdvertiser picks the candidate whose normalized name contains the competitor's and has the most cards.
- `exact-advertiser.html` — query_type=2 render. 12 ads for "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED". `Total ads: 12`. Each card with ad_id, dates, unique users, one with a thumbnail img.
- `zero-ads.html` — query_type=2 render. `Total ads: 0` header present, zero cards. (Real zero, NOT unavailable.)
- `parse-break.html` — no `Total ads:` header, zero cards. (Parse break → unavailable.)
- `decodo-613.json` — a Decodo 613 error response body (e.g. `{"status":613,"message":"quota exceeded"}`) for the 613 test.

Make the fixture HTML realistic enough that your `parseTiktokLibraryHtml` extracts
the cards. Use a simple, consistent card structure, e.g.:
```html
<div class="ad-card">
  <a href="/ads/detail/?ad_id=1234567890">Ad NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED</a>
  <p>First shown: 01/15/2026 Last shown: 02/20/2026 Unique users seen: 5000</p>
  <img src="https://p16-sign.tiktokcdn.com/x.jpg" alt="ad" />
</div>
```
The parser must read `ad_id` from the href, the advertiser from the `<a>` text
(or the card text), dates + unique users from the `<p>` text, thumbnail from
`<img src>`. Be tolerant of missing thumbnail.

Tests:
- `tests/sources/tiktok-ads-library.test.ts`:
  - `parseTiktokLibraryHtml` on `exact-advertiser.html` → 12 ads with correct fields, totalAds 12.
  - `parseTiktokLibraryHtml` on `zero-ads.html` → ads [], totalAds 0.
  - `parseTiktokLibraryHtml` on `parse-break.html` → no totalAds header, ads [] (parser returns totalAds null/undefined; the snapshot logic treats this as unavailable).
  - `resolveAdvertiser` with `resolve-keyword.html` (mock `fetch` to return that HTML via the Decodo response shape) for competitor "new balance" → picks "NEW BALANCE ATHLETIC SHOES (U.K.) LIMITED" (most cards whose name contains "new balance"), candidates recorded.
  - `fetchAds` with `exact-advertiser.html` → 12 ads, totalAds 12.
  - `fetchAds` with `zero-ads.html` → `{ ads: [], totalAds: 0 }` (NOT unavailable).
  - `fetchAds` with `parse-break.html` → `{ unavailable: true, reason: "parse_break" }`.
  - `fetchAds` / `resolveAdvertiser` on Decodo 613 (mock fetch returns 613) → `{ unavailable: true, reason: "quota" }`.
  - Budget deny: mock `reserveDecodoBudget` (mock the `~/lib/decodo-budget.server` module) to return `{ ok: false, reason: "quota" }` → render returns `{ unavailable: true, reason: "quota" }` without calling fetch.
  - Mock `globalThis.fetch` with `vi.spyOn`/`vi.fn` to return `{ ok: true, status: 200, json: async () => ({ content: { html: FIXTURE } }) }`. Use `readFileSync` to load fixtures (tests are node project). Use `vi.mock("~/lib/decodo-budget.server", ...)` to control the budget where needed; otherwise let it return `{ ok: true }` (no KV).
- `tests/sources/tiktok-ads-snapshot.test.ts`:
  - 7-day gate: mock `getLatestSourceSnapshot` (mock `~/lib/sources/run.server`) to return a snapshot with `fetchedAt` 3 days ago → `fetchTiktokSnapshot` returns `{ unavailable: true, reason: "cadence" }` and does NOT call Decodo. 8 days ago → proceeds.
  - No stored advertiser: mock D1 (`ensureDb` returns a prepared statement whose `.first()` returns `{ tiktok_advertiser: null }`), mock resolveAdvertiser+fetchAds (or mock the library module) → returns payload + `competitorUpdate: { tiktok_advertiser }`.
  - Stored advertiser with ads → returns payload, no competitorUpdate.
  - Stored advertiser with totalAds 0 → re-resolve path.
  - `diffTiktokAds`: new ad ids → ad_new; paused (same lastShown, 14+ days old) → ad_inactive; total change → one change. First snapshot (prev null) → only new-ad entries.
  - Budget deny inside snapshot → `{ unavailable: true, reason: "quota" }`.
  - No DECODO_SCRAPER_AUTH → `{ unavailable: true, reason: "not_configured" }`.
  - Mock D1 with a minimal fake `ensureDb` (an object with `.prepare().bind().first()` / `.run()`). Mock `getLatestSourceSnapshot` via `vi.mock("~/lib/sources/run.server", ...)`. Mock the library module via `vi.mock("~/lib/sources/tiktok-ads/tiktok-ad-library.server", ...)` where you want to isolate snapshot logic.

### registry.test.ts — DETECTOR FIX (necessary, document in PR body)
`tests/sources/registry.test.ts` currently asserts ALL adapters are stubs
(`implemented: false`, fetch returns `not_implemented`, diff returns `[]`).
Flipping tiktok to `implemented: true` with real fetch/diff breaks 3 assertions.
This is a detector blind spot: the test assumed all sources stay stubs forever.
Fix it minimally so it is robust to per-source implementation (future source
tickets won't need to re-edit). Change the three "every stub" loops to filter
`SOURCES.filter((a) => !a.implemented)`:
- "every stub adapter exports implemented: false" → iterate unimplemented adapters, assert `implemented` is false.
- "every stub fetch returns unavailable with reason not_implemented" → iterate unimplemented adapters only.
- "every stub diff returns an empty array" → iterate unimplemented adapters only.
Keep the other assertions unchanged ("registers exactly the six source ids",
"getSourceAdapter resolves by id", the two getEnabledSources tests — those still
pass because `baseEnv` has no `DECODO_SCRAPER_AUTH` so tiktok's `requiresEnv` is
false → filtered out → empty).
Do NOT change the test's intent or add tiktok-specific carve-outs; the
`!a.implemented` filter is the whole fix.

### Constraints (must-not)
- NEVER call library.tiktok.com's JSON API directly (only Decodo universal render).
- NEVER exceed the 800/month JS counter (reserveDecodoBudget before every render).
- NEVER use the premium pool (`proxy_pool` stays "standard").
- NEVER run more often than weekly per competitor (7-day gate inside fetch).
- NEVER claim non-EU coverage, spend, or impressions.
- NEVER fetch detail pages per ad (only the 12 cards from the list render).
- NEVER fork the Meta helpers (use the seam's run.server/decodo-budget exports).
- NEVER retry inside the app (ONE attempt, 90s timeout).
- NEVER add a schedule of its own (piggyback on the existing check cadence).
- NEVER edit files outside the owned list (except the registry.test.ts detector fix).

### Termination
```
cd /home/nish/workspaces/agent-worktrees/0509-2194
npx vitest run --configLoader runner --project node tests/sources/tiktok-ads-library.test.ts tests/sources/tiktok-ads-snapshot.test.ts tests/sources/registry.test.ts
```
Do NOT run `npm run typecheck` or `npm test` (CI owns typecheck; the full suite
is heavy). Run only the scoped node-project tests above. If those pass, you are
done — the manager runs the final review + PR.

### Key references (already read by manager; verify paths exist)
- `app/lib/sources/types.ts` — SourceAdapter, SourceFetchResult, SourceChange, SourceFetchContext, SourceSnapshotInput, SourceSnapshotRecord, SourceCompetitorUpdate.
- `app/lib/sources/run.server.ts` — exports `getLatestSourceSnapshot` (consume it).
- `app/lib/decodo-budget.server.ts` — exports `reserveDecodoBudget(env, "js")` (consume it).
- `app/lib/env.server.ts` — `AppEnv`, `DECODO_SCRAPER_AUTH`, `DECODO_BUDGET`.
- `app/lib/data/d1.server.ts` — `ensureDb(env)`.
- `app/lib/data/helpers.server.ts` — `nowIso`, `JsonRecord`.
- `app/lib/types.ts` — `WatchEventType` (`"ad_new"`, `"ad_inactive"`).
- `app/components/watchlists/recent-checks-section.tsx` — Section styling pattern.
- `migrations/0088_competitor_source_fields.sql` — `tiktok_advertiser` column, `source_snapshot` table.

When done: print a summary of files created/changed and the termination result.
