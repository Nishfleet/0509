# Lane evidence — claim/issue-1568

Issue: Nishfleet/0509#1568 — /search empty state lacks cross-link to /capture-rules
Unit: pi-issue-0509-1568
Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-1568

## Change
- `app/routes/search.tsx`: when `completedEmptySearch` (a finished 0-verified
  search), the `.f9-wk-sec-acts` container now renders two inline links:
  - `/capture-rules` — "Read what we refuse to alert on →" (BET 4 artifact)
  - `/ad-aggression` — "How the score works →" (methodology page, secondary)
  The non-empty (>=1 verified) card is unchanged; the cross-links are gated on
  `completedEmptySearch` so they only appear at the 0-verified dead-end.

## Test
- `tests/search/empty-state-cross-link.test.tsx` (new, 3 cases):
  1. 0-verified empty card contains `/capture-rules` + `/ad-aggression` anchors
     with the honest labels.
  2. The `.f9-wk-sec-acts` container is non-empty and carries the capture-rules
     href for the 0-verified case.
  3. The non-empty (>=1 verified) card does NOT render the cross-links.

## Verification
- `npx vitest run tests/search/empty-state-cross-link` → 3 passed.
- `npx vitest run --project node` → 6920 passed (580 files), no regressions.
- `npx tsc -b` → 24 pre-existing errors (e2e/playwright, untouched files);
  0 new errors from this diff (verified by stash comparison: 24 == 24).
