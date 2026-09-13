# Lane evidence — claim/issue-3196 (issue #3196, unit pi-issue-0509-3196)

LinkedIn ad coverage via the public LinkedIn Ad Library (split of #2992).

## Trail (session pickup, #1250 prior art)

- 2026-09-13T16:48:31Z — the unit's first run claimed and worked through several claims; each lost its seat or hit StartLimitBurst before a PR (the heartbeat released the claim 17:50:09Z, 18:49:00Z, 19:50:11Z, then StartLimitBurst 20:07:20Z, 20:33:43Z).
- 2026-09-13T~21:36Z — the last of those runs committed the work; the fleet salvage note banked the worktree at `/home/nish/workspaces/agent-worktrees/issue-0509-3196` → `wip/pi-issue-0509-3196-20260913T213625Z` @ `a74b03f28` (pushed), "success/0" — the code complete, the PR never opened.
- 2026-09-13T21:51:30Z — this run (same unit, re-claimed) resumed the banked worktree (the worktree stays ours, the `bin/pi-salvage-worktree` precedent), rebased the one salvaged commit onto origin/main twice as main moved (bd41132f7-base → ac8a9e763 → cff30e908; both conflict-free), and ships.
- Blocker in the issue body (fleet-ops#5806) closed 2026-09-13T16:37:20Z — verified live via `gh issue view 5806 -R Nishfleet/fleet-ops`; this slice is one of the released splits.

## What shipped (08dc82aef, code — 11 files, +760/−21)

- `LINKEDIN_ADS_SOURCE_DISABLED` kill flag (env.server.ts + wrangler.jsonc vars, "0" = production posture): `requiresEnv` owns it (the #2193 credential requirement stays), so the registry's env filter drops the source from scheduled runs when killed; the /ads + /timeline sections omit via the same rule (`loadBrandPageSourceSnapshots` filters live sources by `requiresEnv`). Unset = on — production keeps the source enabled even before this PR deploys (the flag only exists as a brake).
- `app/lib/sources/linkedin-ads/linkedin-ads-usage.server.ts` (new, 117 lines): per-source capture-usage counters, the #2181 KV budget-counter pattern — `linkedin_ads:captures:YYYY-MM-DD → {attempted, failed}` in the seam's DECODO_BUDGET namespace, 35d TTL, best-effort (every KV step guarded; a counter hiccup never fails a capture). One counted attempt per Library READ (the #2193 quota-deny returns before any read and is not counted) — this is the /status capture-failure rate's denominator (the seam's `source_snapshot` rows only record successes).
- `/status`: a Monitoring-health LinkedIn Ads (Ad Library) row — 24h attempt/failure counters + capture failure rate when the #2181 KV binding is wired; killed = the paused posture (no counters — a paused source has no meaningful rate, no fabricated 0%); no binding = the posture only (the #2200 rule: missing = no false claim; nothing invented).
- `/ads/:domain` LinkedIn Ads section + the watchlist competitor-detail: the honest coverage note (source — the public LinkedIn Ad Library, no official-API key that bars commercial use; ad types — promoted-post cards, no format distinction; what is NOT covered — spend, reach, audience metrics; region — the United States, the public search's verified geo=US posture, no other regions; freshness — the weekly cadence, "Last checked" = the last successful capture) via the shared `source-sections.tsx`, so /ads AND timelines/briefs show it from one component. The section now renders the #2193 stored payload's REAL fields (promoted text, advertiser, public detail link) instead of the TikTok-shaped adId/firstSeen ghost reads.
- Docs coverage table: the `linkedin` row's notes gain the same #3196 facts (the row's productionStatus stays `gated` — that is the PRESENCE connector's rollout, which #3196 does not flip; the ads facts ride the notes; the test pins it).
- Capture-validity gate #2873 preserved: an unavailable capture returns BEFORE any diff — no snapshot, no alert, no phantom change; the previous good snapshot stays the diff base.

## Proof (this worktree, after rebase onto cff30e908; VITEST_MAX_WORKERS=2 respected, one heavy toolchain at a time, no coverage, no typecheck — CI owns those)

- `npx vitest run --configLoader runner --project node --changed origin/main` → **376 files / 4708 tests, all passed** (137s) — at the prior base (ac8a9e763 + the salvage); the rebase onto cff30e908 adds #3419's already-merged files to the base, not to the changed set.
- Scoped at final head 08dc82aef: the 4 acceptance-carrying test files + the #3370 vitest-reporter-convention guard → **5 files / 70 tests, all passed** (`tests/sources/linkedin-ads-adapter.test.ts`, `tests/linkedin-ads-capture-usage.server.test.ts`, `tests/status.route.test.ts`, `tests/ads-brand-page-source-sections.test.tsx`, `tests/vitest-reporter-convention.test.ts`).
- `sgscan --base origin/main` (at final head, since cff30e908) → "No new security findings." (exit 0).
- `crgate` → "CodeRabbit is not signed in on this machine." — headless, no OAuth session; flagged, not explained away; the senior round is the substantive review (the #3394/#3418 precedent; the remote CodeRabbit check still fires via the GitHub app).
- `fleet-review-arm-check` → exit 0 (a senior seat is usable — the reviewer round runs; the seat resolves through the #3121 lookup, now `lib/litellm-seat.sh` — the packet's `lib/seat-lib.sh` path is stale, ENOENT, exit 1, flagged).
- Acceptance → evidence: "e2e fixture brand returns >=1 LinkedIn ad" = the adapter test drives the REAL adapter (only the network/KV boundaries mocked, importOriginal spread) with the e2e fixture watchlist's tracked brand (`e2e-watchlist-firstbrief`) → >=1 LinkedIn ad + the counted attempt — the #3394 precedent's reading of the acceptance (no new Playwright spec; the #3205 precedent: same #2992 split, proof as vitest + this record); "coverage note present" = the component + docs assertions; "per-source rate budget and kill flag tested" = the usage-counter tests (real attempts, 24h window, TTL, unreadable-key resilience) + the kill-flag describe (1/true/yes/on, the registry env filter dropping the killed source, the docs-row honesty) + the pre-existing #2193 budget-deny test; "capture failure rate visible on /status" = the route loader + render tests for the counted / not-wired / killed postures.

## Scope kept (the issue's disjointness)

Touches only the LinkedIn adapter, its flag, its usage counter, its tests, its coverage copy and its /status row — plus this lane record. No shared adapter interface edited (the only `requiresEnv` change rides the flag; the source-sections edit is the LinkedIn section's own body inside the shared file, the #3394 precedent). No migrations — the workers project untouched. No new bin/ files, no new checks, net mechanism: one counter module riding the #2181 pattern.

## Honest limits

- The measured /status counters render once #2181's DECODO_BUDGET KV binding is wired on the deployment; until then the row states the flag posture (the #2200 rule). #2181 owns the wiring decision.
- The /ads coverage note, /status row and the docs-note addition become production-visible after this PR merges AND the next 0509 deploy (fix on a branch is a PR, not production — 08dc82aef is not yet an ancestor of origin/main).
- No new Playwright spec: the #3205 precedent (same #2992 split) shipped its proof as vitest + this lane record.
