# Plan — Nishfleet/0509 #2194 (TikTok Ads source)

Manager mode (difficulty: heavy). Manager plans, delegates, reviews, ships.
Worker implements each phase extremely well.

## Goal
Replace the TikTok Ads stub with a real Decodo-rendered EU-shown ads source:
resolve advertiser legal name, fetch ads weekly, diff, render in the Section.

## Acceptance bullets (one line each)
- [ ] phase 1: tiktok-ad-library.server.ts — Decodo render + parse + resolveAdvertiser + fetchAds + fixtures
- [ ] phase 2: tiktok-ads-snapshot.server.ts — weekly fetch (budget, 7-day gate, resolve, fetchAds) + diff (new/paused/total)
- [ ] phase 3: tiktok-ads.server.ts adapter (implemented true, weekly, requiresEnv DECODO) + tiktok-ads.tsx Section (render snapshot, EU-shown label)
- [ ] phase 4: tests (tiktok-ads-library + tiktok-ads-snapshot: resolve/exact/zero/613/7-day gate/diff) + registry.test.ts detector fix
- [ ] phase 5: termination green (vitest tiktok-ads*), commit, push, PR, arm

## Files owned (edit ONLY these)
- app/lib/sources/tiktok-ads/tiktok-ad-library.server.ts (NEW)
- app/lib/sources/tiktok-ads/tiktok-ads-snapshot.server.ts (NEW)
- app/lib/sources/tiktok-ads.server.ts (REPLACE stub)
- app/components/sources/tiktok-ads.tsx (REPLACE stub)
- tests/sources/tiktok-ads-library.test.ts (NEW)
- tests/sources/tiktok-ads-snapshot.test.ts (NEW)
- tests/fixtures/tiktok-ad-library/** (NEW)
- tests/sources/registry.test.ts (DETECTOR FIX ONLY — see handoff; document in PR body)

## Do NOT edit (seam #2218 owns)
registry.server.ts, run.server.ts, types.ts, env.server.ts, presence-*.ts,
source-sections.tsx, competitor-detail.tsx, decodo-budget.server.ts, migrations,
claim table. Consume decodo-budget and run.server exports only.

## Stall rule
No box ticked in 10 min → commit what works + stalled note.
