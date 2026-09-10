# Plan — Nishfleet/0509 #2193 — LinkedIn Ads presence source

Manager mode (heavy). Dependency #2218 (sources seam) merged; stubs exist at
the owned paths. This ticket replaces the linkedin-ads stub with a real
adapter + Section + tests. Ownership is binding: edit ONLY the files on the
`files:` line. The one exception is `tests/sources/registry.test.ts`, which
asserts ALL adapters are stubs and breaks the moment linkedin flips to
`implemented: true` — it is updated minimally to filter stub assertions by
`!implemented` so the build stays green (documented in the PR body).

## Phases

- [x] phase 1: app/lib/sources/linkedin-ads/linkedin-ad-library.server.ts — fetchAdsByAccountOwner + HTML parser + fixtures (parser verified against all 5 fixtures: page-1=24, page-2=24, ambiguous=3, zero-0, parse-break=0)
- [x] phase 2: app/lib/sources/linkedin-ads.server.ts — real adapter (budget helper, fetch, diff, cadence weekly, implemented true, requiresEnv)
- [x] phase 3: app/components/sources/linkedin-ads.tsx — real Section (render snapshot, null when none)
- [x] phase 4: tests/sources/linkedin-ads*.test.ts + fixtures + registry.test.ts stub-filter update (43 source tests + 9 claim tests green; 32 in the 3 touched files)
- [x] phase 5: verify (vitest run touched tests green), commit, push, PR — PR #2570 opened; stops for independent review (no self-merge)

## Notes

- Decodo v2/scrape response: `{ results: [{ content: "<html>", status_code: 200, ... }] }`. status 613 = Decodo internal failure.
- cadence: "weekly" on the adapter; the seam's runner applies the gate (judge batch-2 edit). No 7-day plumbing in this adapter.
- diff() returns SourceChange[]; the seam emits. eventType: ad_new / ad_inactive / landing_page_headline_changed (copy change).
- requiresEnv: true only when DECODO_SCRAPER_AUTH set (live only when secret present).
- Call reserveDecodoBudget(env, "std") BEFORE every request; on deny → { unavailable: true, reason: "quota" }.
- Page 1 only (start=0), one Decodo request, one attempt, 60s timeout. Do NOT fetch detail pages.
- Account owner = competitorLabel; keep only exact case-insensitive name matches, set ambiguous when non-matches dropped.
- Section renders null when snapshot is null (keeps source-sections.test.tsx green).
- typecheck is CI-owned (memory budget rule); worker runs vitest node project on touched files only.
