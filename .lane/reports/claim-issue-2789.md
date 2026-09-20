# Lane evidence: claim/issue-2789

Issue: Nishfleet/0509#2789 — "presence: stripHtml keeps text inside
<script>/<style> blocks — inline-script noise can still phantom-change a page
snapshot" (review follow-up from #2460 / PR #2787, NOTED bucket).

## What shipped (2026-09-20)

`fetchPageChange` in `app/lib/presence-connectors/website.server.ts` built the
page-snapshot `contentHash` over `stripHtml(response.body).slice(0, 280)`.
`stripHtml` (`rss.server.ts`) strips tags but keeps the *text* inside
`<script>`/`<style>` blocks, so per-poll noise (analytics snippets, build ids)
inside those blocks changed the hash on an identical visible page.

Fix: normalize with the shared `stripScriptAndStyle`
(`app/lib/sanitize-text.server.ts`) before the tag strip. The excerpt is
computed once and shared by the hash input and the stored `bodyExcerpt`, so the
two stay identical (stored-excerpt parity). `extractTitle` runs on the raw body
in a separate path — unchanged. The feed path and RSS excerpts are untouched:
the fix is scoped to the page-snapshot fallback only.

## Verification

- Red: new test failed pre-fix (`vitest run --project node
  tests/presence-connectors-website.server.test.ts` — 1 failed / 4 passed).
- Green: same file 5/5 pass post-fix.
- `npx vitest run --configLoader runner --project node --changed origin/main`:
  116 files / 1362 tests, all pass.
- `semgrep --config p/default --baseline-commit $(git merge-base HEAD
  origin/main)`: clean, exit 0.
