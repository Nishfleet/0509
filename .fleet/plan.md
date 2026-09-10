# .fleet/plan.md — Nishfleet/0509#2181 (google presence source via Decodo Web Scraping API)

Manager: pi-issue-0509-2181. Branch: `claim/issue-2181` (from origin/main @ ff69f596).
Scope gate: only `app/lib/sources/google-search.server.ts`, `app/lib/sources/google-search/**`,
`app/components/sources/google-search.tsx`, `tests/sources/google-search*.test.ts`,
`tests/fixtures/google-search/**` may be edited — plus ONE documented outside-line line in
`tests/sources/registry.test.ts` (see phase 6).

Acceptance bullets (issue body, judge edits batch 2 applied):

- [x] phase 1: do:1 — verify `SERP_PROVIDER` + `DECODO_SCRAPER_AUTH` exist in env.server.ts (seam-owned: verify, never edit) — verified at env.server.ts:113-118, not edited
- [x] phase 1: do:7a — real captured Decodo `google_search` fixture + unavailable fixture in `tests/fixtures/google-search/`
- [x] phase 1: do:3 — `SerpProvider` interface + Decodo adapter: one POST, 60s timeout, ONE attempt, organic `desc`->snippet, `paid[]`->ads, non-200/timeout/parse -> `{unavailable, reason}`
- [x] phase 2: do:3 — `fetchGoogleSerp` picks the provider from `SERP_PROVIDER`; `gateway` throws not-implemented

### Phase 2 reviewer round (commit pending)
Reviewer seat: parent seat (stock reviewer). Verdict: APPROVE, 4 Warnings + 6 Suggestions.
- Act on: the thrown misconfiguration (`SERP_PROVIDER` typo / `gateway`) is swallowed by the seam's `runOneSource` with no log — phase 3's adapter must catch, log, and return a distinct reason. Also coerce a non-string `SERP_PROVIDER` via `String(...)` so a bad config value reports as `unknown serp provider` instead of a swallowed TypeError, and add the assertion that the selector call actually reached the provider (proves the `not_configured` guard is not duplicated here).
- Consider, done or deferred: provider-neutral deps alias (Consider); raw-vs-normalized value in the unknown-provider message (Noted — the PR body records the trade-off); case tolerance on the gateway branch (Consider); shared test env factory (Noted).
- Noted: the gateway path never constructs the Decodo factory, so "no quota spend" there is structural, not behavioural — not cited as evidence.
- [x] phase 1/2: must-not — `reserveDecodoBudget(env,"std")` BEFORE every Decodo request; deny -> `{unavailable, reason:"quota"}`; never build a counter

### Phase 1 reviewer round (commit 7c06ecf7)
Reviewer seat: parent seat (stock reviewer). Verdict: BLOCK, one Critical + five Warnings.
- Act on (Critical): fixture `decodo-nike.json` tripped the required Gitleaks check (16 `generic-api-key` hits from the unused `popular_products` block). Fixed by deleting that block and AMENDING the unpushed phase-1 commit, so the leaking blob is in no reachable ref: `gitleaks git . --log-opts "ff69f596..HEAD"` -> `no leaks found`, exit 0.
- Act on (Warnings): fail closed on `content.status_code` / non-empty `content.errors`; handle Decodo's real top-level `{"status":613}` body; `not_configured` returned before the budget reserve and before any request; paid-row `url` normalized to absolute http(s) only.
- Consider, done: literal request-body pin, 60s default timeout assertion, no-token-in-result assertion, `displayHost` doc corrected.
- Noted: organic rows dropped for an unusable URL are not counted (kept out of the `SerpResult` contract the issue fixes); both live captures contain absolute organic URLs, so the branch is synthetic-only. Revisit only if a real capture shows a relative organic URL.
- Noted: `.lane/reports/claim-issue-2181.md` not written (lane evidence is optional here; the PR body carries the proof).
- [x] phase 3: do:4 — snapshot payload = sponsored + top-10 organic; diff(prev,next) returns `SourceChange[]` for new/removed sponsored advertiser domains, own domain +-3 positions or entering/leaving the top 10, new domains entering the top 10
- [x] phase 3: do:2 — adapter `implemented: true`, `requiresEnv` checks the selected provider credentials; coverage flips by the seam rule (presence files untouched)
- [x] phase 4: do:3 — brand query = competitor display name else registrable-domain stem; adapter wires watchlist -> domain -> query -> snapshot, unavailable passes through, Meta check never blocked
- [x] phase 5: do:5 — `app/components/sources/google-search.tsx` renders sponsored list + organic top 10 with position deltas inside the seam's `<SourceSections/>` slot (no competitor-page edit)
- [ ] phase 6: do:7b — coverage state with/without env proven; registry test guard; cadence math (8 checks/day x competitors x 30 <= 1,500) in the PR body
- [ ] phase 6: inner loop green, sgscan, crgate, PR + reviewer round + arm

Deviations agreed up front (both recorded in the PR body):

1. **No `proxy_pool` in the request body.** The issue text and Fable's budget note order
   `"proxy_pool":"standard"`; the live API returns HTTP 400
   `"proxy_pool" parameter customization is only supported in the Universal Web Scraping target`
   and the official Google Search template docs list no `proxy_pool`. Request body is exactly
   `{target, query, parse, geo, locale}`.
2. **No local `npm run typecheck`.** Fleet memory-budget rule (fleet-ops#4891) forbids
   `tsc -b` / `npm run typecheck` inside a worker; CI owns typecheck. Targeted vitest only.
3. **One line in `tests/sources/registry.test.ts`.** `expect(stubs.length).toBeGreaterThan(0)`
   was added by #2198 over a seam test that was deliberately stub-count-agnostic; `google` is the
   last stub, so flipping it makes that assertion unsatisfiable. Removing it restores the seam's
   intent. Documented in the PR body and flagged on the issue.

Payload key contract (seam-owned public brand page reads these exact keys —
`app/components/brand-page/source-sections.tsx` `GoogleSearchBrandSection`):
`{ domain, fetchedAt, sponsoredAdvertisers: string[], organic: [{ position, url, title, prevPosition }] }`.
`prevPosition` is filled by the adapter from the previous stored snapshot (one bounded read via
the seam's `getLatestSourceSnapshot`) so the public page's delta rendering is live.

## Resume note (pi-issue-0509-2181, run 2, 2026-09-11)
Inherited salvage commits 6993001a + b21194fa: snapshot/diff module, adapter,
adapter+snapshot+serp tests, registry.test.ts guard line. Phases 3 and 4 are
IMPLEMENTED and tested (77 google-search tests green) but had no reviewer round
yet — the final reviewer pass covers them together with phase 5.
Phase 5 delegated to a fresh worker subagent with this file + the module
headers as the handoff.

### Phase 3-5 reviewer round (commit bd65e254)
Reviewer: stock reviewer subagent on the phases 3-5 diff (bc8157c3..HEAD) + a
senior-seat reviewer pass on origin/main...HEAD (seat: opencode/nemotron-3-ultra-free,
result pasted below when it lands).
- Act on, fixed: 864-line snapshot spec tripped the 800-line file-size ratchet
  (tests/file-size-ratchet.test.ts) — split into google-search-snapshot-build
  (389) + google-search-snapshot-diff (531), 29 tests preserved, ratchet green.
- Consider, done: diffChangeCount counted only 2 of 6 change categories — now
  counts all diff entries; stale "1,500/month" comment corrected to the real
  DECODO_LIMITS.std = 1,800.
- Consider, deferred: no dedicated section render spec — the issue's files:
  glob is `tests/sources/google-search*.test.ts` (a `.tsx` spec sits outside
  it) and the worker's throwaway smoke render passed all 4 assertions.
- Noted: in-app Section is dormant until #2188 wires `snapshots` into
  SourceSections — seam design, not a defect. Payload keys verified against
  the public brand page's read contract.
- Routed out of scope: hiring `requiresEnv: () => false` inversion filed as
  Nishfleet/0509#2709. Deploy-workflow DECODO_SCRAPER_AUTH sync step filed as
  Nishfleet/0509#2710 (worker token has no Workflows scope).
