# Stale open PRs #573/#574/#584 (2026-08-11 lane 1) — already merged / superseded, closed

**Status: resolved; this lane closed the stale PRs and records the evidence.**

Branch: `report/lane1-stale-prs-573-574-584-closed`
Base: `origin/main` at `69cfcbc0`

## Item

- [ ] Close open PRs #573/#574/#584 as superseded — their exact content
  already merged, and rebasing them would just re-apply already-merged
  changes.

## Verdict

All three PRs were already resolved on `origin/main`; no code change was
warranted. #573 and #584 were open and are now closed (with evidence
comments); #574 had already merged before this lane started.

- PR #574 — "docs(marketing): prepare manual SaaSHub listing for Five to
  Nine" — **already MERGED** 2026-08-10T22:41:29Z as `69cfcbc0`, the current
  `main` HEAD. `docs/saashub-listing.md` on the PR branch is byte-identical
  to `origin/main`. Nothing to close.
- PR #573 — "docs(traction): prepare the manual AlternativeTo listing" —
  **superseded by PR #606** (`adceefdd`, merged 2026-08-10T21:30:53Z):
  `docs/alternativeto-listing-2026-08-11.md` (327 lines) is the newer,
  complete listing packet for the same research-desk item (FAQ-verified
  eligibility, ready-to-paste form fields, submission process, honesty
  guardrails). The PR's `docs/growth/*` files are the earlier draft; the
  `docs/growth/` directory no longer exists on main. Closed 2026-08-11.
- PR #584 — "fix(search): make the BL-031 refine-disclosure tests
  typecheck-clean (TS2698)" — **fix already on main**: commit `5021807e`
  (PR #585, merged 2026-08-10) added the `as Record<string, unknown>` casts
  at both spread sites in `tests/search-submission-settle.test.tsx` (lines
  541 and 560 on current main). The only diff between the branch and main
  is formatting (single-line vs multi-line spread); runtime behavior is
  identical. Closed 2026-08-11.

## Evidence on current main

- `git diff origin/main origin/docs/saashub-listing -- docs/saashub-listing.md`
  → empty (PR #574 content identical to main).
- `git show origin/main:tests/search-submission-settle.test.tsx` → lines 541
  and 560 already carry `... (resultsLoaderData.filters as Record<string,
  unknown>), ...`; `git log -S` attributes them to `5021807e` (#585).
- `git log origin/main --oneline -- docs/alternativeto-listing-2026-08-11.md`
  → `adceefdd` (#606), ancestor of current main HEAD.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
