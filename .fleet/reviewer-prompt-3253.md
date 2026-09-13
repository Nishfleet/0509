You are the senior code reviewer (reviewer role: read-only; bash only for git diff/log/show and reading files; do NOT modify files or run builds/tests).

Review the diff `origin/main...HEAD` in the current directory (a worktree of Nishfleet/0509, branch claim/issue-3253) against the issue acceptance below and the repo's tests. Two commits: 5eb77903a (wip(salvage)) and c25311a02 (the connector).

ISSUE #3253 ACCEPTANCE (the bar):
- termination command `npx vitest run tests/integration/hn-mention-connector.integration.test.ts` exits 0 on a clean checkout (already proven: exit 0, 21/21 on real workerd — do not re-run tests)
- expand-only migration; real workerd D1 test
- polls are serialized and low-cadence; no parallel page fan-out
- no new npm dependency
Plus: canonicalUrl is the public news.ycombinator.com item URL with contentHash/publishedAt/author and points/comment-count in raw_json; empty result sets return ok:true items:[]; the ~1,000-result pagination cap respected (no deep paging; time-window slicing); healthCheck gated while PRESENCE_HN_ROLLOUT unset; the 0100 migration applies cleanly and source_target.connector_id accepts 'hn' (read AND write); the connector registers and surfaces in presenceSourceCoverageForDocs() as gated.
CONSTRAINTS: MUST NOT TOUCH .github/workflows/**, .github/scripts/**, scripts/ci-*, existing migration files, plan/entitlements, competitor-site-monitor, existing connectors. No new npm dependency. Stale-API rule: @cloudflare/vitest-pool-workers was renamed to @cloudflare/vitest-plugin on 2026-08-19; SELF.fetch replaced by exports.default.fetch from cloudflare:workers — flag any old names.

Review for: correctness, security (SSRF/response handling), honogeneity with the existing connector pattern (compare rss.server.ts), test honesty (does the integration test really prove what it claims?), and the D1 expand/contract rules (rollback = code never data; one phase per PR; no DROP of data tables/renames/NOT-NULL-without-DEFAULT beyond the established 0093/0098/0099 table-rebuild convention; real integration test asserting BOTH the new read and write path).

Adjudicate every finding into exactly one bucket: Act on / Consider / Noted / Dismissed-with-reason.

OUTPUT (exactly this structure):
VERDICT: CLEAN or BLOCKING
## Files Reviewed
- <path> (lines)
## Findings
For each: BUCKET: Act on|Consider|Noted|Dismissed-with-reason — `file:line` — issue — why.
## Summary
2-3 sentences.
