You are the reviewer for one diff in this repo worktree: /home/nish/workspaces/agent-worktrees/issue-0509-3476

Use reviewer to review the diff `origin/main...HEAD` against the issue acceptance and the repo tests.

Issue Nishfleet/0509#3476 acceptance:
- /brands renders `href="/timeline/<domain>"` for every domain in the /ads ∩ /timeline indexable intersection, and `node scripts/check-ads-timeline-links.mjs` exits 0.
- If the gap is a silent loader failure, the degradation should be observable (log/metric), not silent.

The diff (committed on claim/issue-3476) does:
1. app/lib/sitemap.server.ts — loadIndexableTimelineEntries retries its bounded ~100k-row D1 read once on non-schema errors before propagating.
2. app/lib/ads-internal-links.server.ts — both catches now `await reportError(env, {route: "loader.ads_internal_links", reasonCode, error})` so the degrade lands in the error_report sink.
3. scripts/check-ads-timeline-links.mjs — asserted /ads + /brands fetches carry a per-run `__sweep=<ts>` query param so the sweep reads the fresh origin render, not a stale edge-cached copy.
4. Tests added/updated in tests/sitemap.server.test.ts and tests/ads-brand-page.internal-links.test.ts.

Run `git diff origin/main...HEAD` yourself in that worktree and read the touched files. Report findings ordered by severity; say explicitly if the diff is clean.
