# Lane evidence — claim/issue-3195 (Nishfleet/0509 #3195, unit pi-issue-0509-3195)

## Pickup (session-pickup, not re-derivation)

Three prior runs of this unit died (2× success/0 without shipping, 1× exit-code/1; then StartLimitBurst). Their salvage notes banked the work. Inherited, verified, not redone:

- Salvage branch `wip/pi-issue-0509-3195-20260913T200716Z` @ `0228af92e` (pushed) and this worktree's `claim/issue-3195` @ `ed1da0745` carry **byte-identical changesets** (13 files, +256/−8 each, verified by `git diff --stat` against each one's merge-base): the implementation was complete; the dying runs only never shipped.
- This worktree's copy sits on the newest `origin/main` (bd41132f7), so it IS the resume point. No rebase, no divergence resolution needed beyond the push.

## What the diff is (13 files, +256/−8, app/ + tests/ + docs/registry only)

- Termination "flag is on in production": the flag IS `requiresEnv → DECODO_SCRAPER_AUTH` (shared with the already-live Meta/Decodo credential) + the plan's `sources` entitlement (`free: ["meta"]`, everything else `"all"`) — pinned both ways in `tests/sources/registry.test.ts` (+3 cases: enabled-with-credential, killed-without, off-the-free-plan). Production already sets the shared credential, so TikTok is ON at the read gate the moment a snapshot exists — no wrangler change (the "flag" was never a wrangler var; the prior coverage copy now says exactly what gates it).
- Coverage note (region, ad types, freshness, what the library does NOT publish, the 800-req/month shared budget, the credential): `presence-source-coverage.server.ts` flips the docs row `coming_soon → active` with the honest note; `/ads/:domain` section + shared component gain the freshness line (`Last captured: <date> — this source rechecks weekly`); public-markdown (page + llms.txt) both now name the TikTok scope.
- `/status` capture-failure gap: `public-status-counters.server.ts` adds `tiktokCapturesInLast8d` (distinct watchlists with a stored `source_snapshot` for `source_id='tiktok'` in 8 days = this week's expected capture + 1 day scheduling slack); the monitoring surface reads it as "N of M active watchlists captured — the capture-failure gap" (both the 0-rows degrade and the populated read tested).
- Capture-validity (#2873) at the read tier: the integration test proves a FAILED/never-run capture stores no snapshot row → the section is omitted entirely, never a phantom "No EU-shown TikTok ads found" (third `it()`).
- Timelines + briefs (termination): ride the EXISTING generic gates, no diff needed, verified: `/timeline/:domain` filters watch_events by `SOURCES.filter(implemented && requiresEnv(env))` and the TikTok adapter ships `implemented: true` (`app/lib/sources/tiktok-ads.server.ts:19`); signed-in briefs/competitor detail render through `sources/source-sections.tsx → TiktokAdsSection` on the same `getLatestSourceSnapshot` store. "Touch only the TikTok adapter, its flag, its tests and its coverage copy" — honored; no shared interface edited.
- `docs/customer-claim-surface-registry.json` +2/−2 only. `docs/customer-claim-table.json`'s `AUDIT-SOURCE-TIKTOK-ADS-STUB` row stays as-is ON PURPOSE: its own row text reserves the production proof/status flip to #2188 ("#2194 lands the real adapter, #2188 flips the claim"). Filing nothing extra.

## Runs (this worktree @ ed1da0745, VITEST_MAX_WORKERS=2 / PLAYWRIGHT_WORKERS=1 respected, one suite at a time)

- `npx vitest run --configLoader runner --project node --changed origin/main` → **146 files / 1786 tests, 0 failed** (47.88s). No coverage, no typecheck (CI owns both).
- `npx vitest run --configLoader runner --project workers tests/integration/tiktok-ads-brand-page.integration.test.ts` → **3/3 passed** on real workerd + real D1 migrations (4.61s) — includes the acceptance bullet: the e2e fixture brand's stored snapshot returns `>=1` TikTok ad through the REAL `/ads/:domain` read gate, the kill-flag case (no credential → no section), and the #2873 no-phantom case.
- `sgscan --base origin/main` → "No new security findings" (exit 0).
- `crgate` → "CodeRabbit is not signed in on this machine" (exit 0) — the CLI said so, no local CodeRabbit review ran; flagged, not explained away. The substantive review is the senior-seat round recorded in the PR body (same posture as #3410).
- `fleet-review-arm-check` → exit 0 (a senior seat is usable; `find_senior_seat` → `litellm` / `senior`).

## Loose ends

- The `metric:` bullets (share of tracked brands with >=1 TikTok ad; capture failure rate) are the /status + coverage figures this diff ships; no dashboard/new mechanism added — the issue's mechanical-fix bar is the shipped detectors+tests above, not a new organ.
- #2188 still owns the claim-table flip (deliberate, not forgotten — see the row's own note).
