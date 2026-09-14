# Lane evidence — claim/issue-3197 (issue #3197, unit pi-issue-0509-3197)

Google ad coverage via the public Google Ads Transparency Center (split of #2992).

## Trail (session pickup, #1250 prior art)

- 2026-09-13T16:37:24Z — unit claimed, built a worktree, committed the work (c6318f4e5), lost its seat before push/PR.
- 2026-09-13T17:50:05Z — fleet-heartbeat released the claim ("no live worker, no open PR").
- 2026-09-13T17:52:09Z — the same unit re-claimed; this run salvaged the worktree (`bin/pi-salvage-worktree` precedent: the worktree stays ours), rebased the one salvaged commit onto origin/main @ 368f761f9 → 69113eea5, and shipped.
- Blocker in the issue body (fleet-ops#5806) closed 2026-09-13T16:37:20Z — "release the split product slices"; this slice is one of those.

## What shipped (69113eea5, code)

- `GOOGLE_ADS_SOURCE_DISABLED` kill flag (env.server.ts + wrangler.jsonc vars, "0" = production posture): `requiresEnv` owns it, so the registry's env filter drops the source from scheduled runs when killed; coverage resolves to "coming_soon"; the /ads + /timeline sections omit. Unset = on — production keeps the source enabled even before this PR deploys (the flag only exists as a brake).
- `app/lib/sources/google-ads/google-ads-usage.server.ts` (new, 115 lines): per-source capture-usage counters, the #2181 KV budget-counter pattern — `google_ads:captures:YYYY-MM-DD → {attempted, failed}` in the seam's DECODO_BUDGET namespace, 35d TTL, best-effort (every KV step guarded; a counter hiccup never fails a capture). One counted attempt per `fetch()`, success or failure — this is the /status rate's denominator (the seam's `source_snapshot` rows only record successes).
- `/status`: a Monitoring-health Google Ads row — 24h attempt/failure counters + capture failure rate when the KV binding is wired; killed = the paused posture; no binding = the posture only (the #2200 rule: missing = no false claim; nothing invented, no fabricated 0%).
- `/ads/:domain` Google Ads section + the watchlist competitor-detail: the honest coverage note (source, ad types — image and text, video not separately distinguishable; region — whatever the public Transparency Center serves without sign-in, no pinned country filter; freshness — the regular monitoring cadence) via the shared `source-sections.tsx`, so /ads AND timelines/briefs show it from one component.
- Docs coverage table: `google_ads` productionStatus coming_soon → active with the same facts.
- Capture-validity gate #2873 preserved: an unavailable capture returns BEFORE any diff — no snapshot, no alert, no phantom change; the previous good snapshot stays the diff base.

## Proof (this worktree, after rebase onto 368f761f9; VITEST_MAX_WORKERS=2 respected, one heavy toolchain at a time)

- `npx vitest run --configLoader runner --project node --changed origin/main --reporter=dot` → 373 files / 4645 tests, all passed (117s).
- Scoped: the 4 acceptance-carrying test files + the #3370 vitest-reporter-convention guard → 5 files / 53 tests, all passed (`tests/sources/google-ads-adapter.test.ts`, `tests/google-ads-capture-usage.server.test.ts`, `tests/status.route.test.ts`, `tests/ads-brand-page-source-sections.test.tsx`, `tests/vitest-reporter-convention.test.ts`).
- `sgscan --base origin/main` → "No new security findings."
- `crgate` → "CodeRabbit is not signed in on this machine" — headless, no OAuth session; flagged, not explained away; the senior round is the substantive review (the #3371/#3383 precedent).
- Acceptance → evidence: "e2e fixture brand returns >=1 Google ad" = the adapter test drives the REAL adapter (only network/DB boundaries mocked, importOriginal spread) with the fixture brand's domain → >=1 creative + the counted attempt; "coverage note present" = component + docs assertions; "per-source rate budget and kill flag tested" = the usage-counter tests (real attempts, 24h window, TTL, unreadable-key resilience) + the kill-flag describe (registry env filter, coverage coming_soon, docs-honesty); "capture failure rate visible on /status" = the route loader + render tests for the counted / not-wired / killed postures.

## Scope kept (the issue's disjointness)

Touches only the Google adapter, its flag, its usage counter, its tests, its coverage copy and its /status row. No shared adapter interface edited (the only `requiresEnv` change is the flag's own teeth, from `() => true` to `!killed` — the documented #3197 seam). No migrations — the workers project untouched. No new bin/ files, no new checks, net mechanism: one counter module riding the #2181 pattern.

## Honest limits

- The measured /status counters render once #2181's DECODO_BUDGET KV binding is wired on the deployment; until then the row states the flag posture (the #2200 rule). #2181 owns the wiring decision.
- The /ads coverage note, /status row and docs-`active` flip become production-visible after this PR merges AND the next 0509 deploy (fix on a branch is a PR, not production — 69113eea5 is not yet an ancestor of origin/main).
- No new Playwright spec: the #3205 precedent (same #2992 split) shipped its proof as vitest + this lane record.
