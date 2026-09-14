# Handoff — phase 3 for issue #3421 (worker: complete phase 3 extremely well)

Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-3421 (branch claim/issue-3421, rebased on origin/main aaa189b80 — already done, do not rebase).

Plan file: .fleet/plan-3421.md — phases 1 and 2 all ticked; phase 3 is YOUR work (tests + verify-to-green). Do not touch phase 1/2 files except to read them.

git log since last phase:
37f0bb33e wip(salvage): pi-issue-0509-3421 success/0   <- phase 1+2 work, rebased
aaa189b80 Merge pull request #3452 (origin/main)

Previous phases' outcome (phase 1 worker + phase 2 worker, reconstructed from the committed diff — both already committed, do not redo):
- Phase 1: app/routes/guides.can-ChatGPT-monitor-competitor-ads.tsx (375 lines) — three fact blocks (403 re-checked 13 September 2026 / one point in time / 03:00 vigilance), AI-strengths + watch-ownership sections, exported FAQ array `canChatGPTMonitorCompetitorAdsFaqEntries`, CTA Form action=/search with hidden source=guide-can-chatgpt-monitor-ads, exported `guideSearchPreviewPath = "/search?source=guide-can-chatgpt-monitor-ads"`, GuideKeepReading links, WebPage+Article+FAQPage JSON-LD via ~/lib/seo helpers, publicSeoMeta, canonicalLinks+buyerSurfaceHreflangLinks. $locale mirror app/routes/$locale.guides.can-ChatGPT-monitor-competitor-ads.tsx re-exports meta+component with canonical→EN. signup-source.ts adds GUIDE_CAN_CHATGPT_MONITOR_ADS_SIGNUP_SOURCE = "guide-can-chatgpt-monitor-ads" (lowercase; PATH slug keeps uppercase ChatGPT).
- Phase 2: routes.ts EN + $locale cluster lines; locale-markets.ts BUYER_SURFACE_GUIDE_PATHS +1; seo.ts SITEMAP_PATHS +1; public-markdown.ts LLMS_PAGE_DETAILS +1; guides.tsx GUIDE_ENTRIES +1; docs.tsx + competitor-monitoring.tsx inbound links.
- Baseline already proven green by the manager: `npx vitest run tests/guides-routes.test.ts tests/section-parents.test.ts tests/guides-how-to-track.route.test.ts` → 51 passed (the triple-agreement and inbound-link invariant blocks already accept the new path).

Phase 3 = the 6 items in .fleet/plan-3421.md, concretely:

1. Extend tests/guides-routes.test.ts — add a new top-level describe block for this guide, in the same posture as the existing "guides meta-ad-library-api-limitations route (issue #3127)" block (lines ~376-543): renders the honest copy (assert the three fact-block headlines and the honest AI-strengths + watch-ownership sections), declares canonical URL + public SEO meta, is registered as a route (EN + $locale cluster) and published in the sitemap, emits one FAQPage JSON-LD block whose mainEntity count matches the visible FAQ entries, emits the Article JSON-LD entity whose headline matches the visible h1, allowlists the guide-can-chatgpt-monitor-ads signup source marker, is internally linked from /docs and /competitor-monitoring. Pin the EXACT uppercase slug /guides/can-ChatGPT-monitor-competitor-ads everywhere.

2. Add tests/guides-can-ChatGPT-monitor-competitor-ads.route.test.ts in the tests/guides-how-to-track.route.test.ts posture (read that file first — 123 lines — and follow its mock/helper pattern exactly: ./helpers/mock-react-router, vi.resetModules, renderToStaticMarkup). Cover: route renders, meta/og/structured data present (WebPage + Article + FAQPage JSON-LD), sitemap entry present, signup source marker on the /search form, and the exact uppercase slug pinned.

3. The uppercase-slug fact (already verified by the manager — do not re-litigate): the registry's mechanical corpus regexes ([a-z0-9-]+) simply don't match the uppercase slug, so triple-agreement gates stay green; parseSocialCardPathname and guideSocialCardForPathname use [^/]+ and accept it; section-parents.test.ts compares runtime arrays so it sees it fine. No gate reshaping expected — if you find you MUST reshape an existing assertion, stop and report back instead (that is a plan amendment, manager decides).

4. No test deleted; if an assertion must be reshaped rather than extended, add the #3414 convention `test-removal-justified:` trailer to the committing commit (per .fleet/plan-3421.md phase 3).

5. Memory rules — bare vitest only (NO --reporter flag, Vitest 4 removed basic), respect VITEST_MAX_WORKERS=2 (never pass --maxWorkers above it, never run two test suites in parallel shells), never coverage/typecheck/tsc (CI owns typecheck).

6. Verify-to-green: `npx vitest run tests/guides-routes.test.ts tests/guides-can-ChatGPT-monitor-competitor-ads.route.test.ts` — both files pass. Also re-run `npx vitest run tests/section-parents.test.ts tests/guides-how-to-track.route.test.ts` to prove nothing regressed. Report the real run output.

Rules: no migrations, no D1, no gate-owned edits, no app/ changes (tests only — if you believe an app/ change is required, stop and report, manager decides). Stay strictly inside phase 3. When done: tick the phase 3 boxes in .fleet/plan-3421.md, commit as ONE commit `test(growth): pin /guides/can-ChatGPT-monitor-competitor-ads route contract (phase 3, #3421)` — do not push (manager pushes). Print your final message: what you did, the real verify output, and anything the manager must know.
