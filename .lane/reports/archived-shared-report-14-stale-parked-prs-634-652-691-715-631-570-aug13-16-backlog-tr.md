# Stale/parked PRs #634 #652 #691 #715 #631 #570 (AUG13-16 backlog triage) — all landed, nothing stale or dead

**Status: resolved. The triage queue is empty: all six parked PRs are now MERGED on `main`. No code change was required beyond landing #652 (the one still-open, green, mergeable PR).**

Branch: `report/lane1-stale-prs-634-652-691-715-631-570-triage`
Base: `origin/main` at `ae1b545b` (immediately after landing #652)

## Item

- [ ] Triage parked PRs #634 #652 #691 #715 #631 #570 — land the green,
  rebase the stale, close the dead with reasons.

## Verdict

Five of the six PRs had already landed on `main` before this lane started;
the one that was still open — #652 — was green (all CI checks passing:
`Gitleaks`, `codex-node-checks`, `required-verifier-integrity`), **CLEAN /
MERGEABLE** against `main`, and was merged by this lane (land-the-green).
There was nothing stale (no PR conflicted with `main`) and nothing dead to
close. Triage is complete; the parked-PR backlog is empty.

Per-PR disposition (all MERGED):

- PR #634 — "feat(marketing): publish real Dodo prices in SSR HTML and make
  the annual toggle work" — **MERGED** 2026-08-19T13:46:26Z (`bea60162`).
  Already landed before this lane.
- PR #652 — "fix(ads): live claim flips at the exact moments-ago boundary" —
  **MERGED 2026-08-19T16:02:50Z by this lane** (`ae1b545b`). The only PR
  still OPEN at lane start; `mergeStateStatus=CLEAN`, `mergeable=MERGEABLE`,
  all three required checks green. Landed the green with a merge commit.
- PR #691 — "fix(search): never render U+FFFD broken emoji in ad copy on
  /search" — **MERGED** 2026-08-19T06:14:13Z (`1f126173`). Already landed.
- PR #715 — "feat(watch): side-by-side before/after screenshots on watchlist
  change events" — **MERGED** 2026-08-16T19:06:58Z (`feb1d460`). Already
  landed.
- PR #631 — "feat(activation): same-session first value — live first scan and
  mini-brief landing on Overview" — **MERGED** 2026-08-18T18:38:35Z
  (`9e127e4a`). Already landed.
- PR #570 — "fix(seo): point auth-gated public links straight at the login
  destination (dogfood ffcd440eda79)" — **MERGED** 2026-08-16T18:30:57Z
  (`a0f82a61`). Already landed.

## Evidence

- `gh pr view 652` → `state=OPEN`, `mergeStateStatus=CLEAN`, `mergeable=MERGEABLE`,
  checks: Gitleaks pass, codex-node-checks pass, required-verifier-integrity
  pass, before merge.
- `gh pr merge 652 --merge` succeeded; `gh pr view 652` now reports
  `state=MERGED` at 2026-08-19T16:02:50Z, merge commit `ae1b545b`.
- `gh pr view {634,691,715,631,570} --json state` → all `MERGED` with the
  merge timestamps/commits listed above.

## Files

- `.lane/report.md` — evidence record only; no product code touched by the report.
