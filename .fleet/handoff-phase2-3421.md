# Handoff — phase 2 for issue #3421 (worker: complete phase 2 extremely well)

Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-3421 (branch claim/issue-3421, rebased on origin/main ce9fe5517).

Plan file: .fleet/plan-3421.md — phases 1 all ticked, phase 2 has the 8 registry items, phase 3 is tests (do NOT do phase 3's test work; only phase 2's 8 items).

git log since last phase (phase 1 = the wip(salvage) commit):
f70ee94bf wip(salvage): pi-issue-0509-3421 success/0   <- phase 1: route + $locale mirror + signup marker, already committed
ce9fe5517 Merge pull request #3416 (origin/main)

Previous phase's final message (phase 1, salvaged): route app/routes/guides.can-ChatGPT-monitor-competitor-ads.tsx complete with three fact blocks (403 re-checked 13 September 2026 / one point in time / 03:00 vigilance), AI-strengths + watch-ownership sections, FAQ array export `canChatGPTMonitorCompetitorAdsFaqEntries`, CTA Form action=/search with hidden source=guide-can-chatgpt-monitor-ads, GuideKeepReading links to how-to-track-competitor-ads + meta-ad-library-api-limitations, WebPage+Article+FAQPage JSON-LD, publicSeoMeta, canonicalLinks+buyerSurfaceHreflangLinks. $locale mirror re-exports meta+component with canonical→EN. signup-source.ts adds GUIDE_CAN_CHATGPT_MONITOR_ADS_SIGNUP_SOURCE = "guide-can-chatgpt-monitor-ads" (lowercase; PATH slug keeps uppercase ChatGPT).

Phase 2 = the 8 mechanical registry items EXACTLY as listed in .fleet/plan-3421.md:
1. app/routes.ts EN line — route("guides/can-ChatGPT-monitor-competitor-ads", "routes/guides.can-ChatGPT-monitor-competitor-ads.tsx") near the other guide routes (~line 178 area)
2. app/routes.ts $locale cluster line — route("guides/can-ChatGPT-monitor-competitor-ads", "routes/$locale.guides.can-ChatGPT-monitor-competitor-ads.tsx") (~line 273 area)
3. app/lib/locale-markets.ts — add "/guides/can-ChatGPT-monitor-competitor-ads" to BUYER_SURFACE_GUIDE_PATHS (~line 115 area)
4. app/lib/seo.ts — add "/guides/can-ChatGPT-monitor-competitor-ads" to SITEMAP_PATHS guide block (~line 1081 area)
5. app/lib/public-markdown.ts — add LLMS_PAGE_DETAILS entry (~line 158 area) — REQUIRED: the _llmsDetailsCoverSitemap mapped type makes a missing description a compile error under CI typecheck; write a one-sentence description sourced ONLY from the page's own copy
6. app/routes/guides.tsx — GUIDE_ENTRIES +1 card (~line 39 area), section-parents.test.ts pins exact set equality with sitemap paths
7. app/routes/docs.tsx — one <Link to="/guides/can-ChatGPT-monitor-competitor-ads"> inbound link (#3167 invariant) — place it sensibly near other guide links; follow the exact Link style used there
8. app/routes/competitor-monitoring.tsx — one <Link to="/guides/can-ChatGPT-monitor-competitor-ads"> inbound link (#3167 invariant) — same rule

Rules: no migrations, no D1, no gate-owned edits, no test deletion, bare vitest only if you run any check (no --reporter flag), never coverage/typecheck/tsc (CI owns typecheck). Respect VITEST_MAX_WORKERS. Stay strictly inside phase 2's 8 items — phase 3 (tests) is a separate worker. When done, tick the phase 2 boxes in .fleet/plan-3421.md and commit as one commit: `feat(growth): wire /guides/can-ChatGPT-monitor-competitor-ads into the registry (phase 2, #3421)` — do not push (manager pushes).
