# Lane evidence — claim/issue-3659 (issue #3659, unit pi-issue-0509-3659)

## What this lane is

#3659 carries three senior-reviewer findings on #3656, all stale-prose class:

1. `tests/auto-revert-workflow.test.ts` — spec title/comments still describing
   `halt()` as filing an issue after #3220 stopped that.
2. `.github/workflows/auto-revert.yml` — header/inner comments describing the
   same defunct issue-filing flow.
3. `config/rule-enforcement.json` (~line 320) — proof-pointer citing
   `tests/auto-revert-required-check-gate.test.sh`, a file that never existed
   in this repo's history.

ACCEPT clause: "the stale prose is corrected or removed, and the dangling
proof-pointer in rule-enforcement.json either points at a real artifact or is
removed."

## Why the enumerated findings needed a different remedy than editing

Both files in findings 1 and 2 were deleted on main at 5d19b38e0 (the #3679
watcher batch, 2026-09-20 — PR #3692) BEFORE this lane claimed the issue
(16:16Z that day): the stale prose in them is gone with the files. Finding 3's
`config/rule-enforcement.json` was removed from this repo by 5101c77b4 the same
day ("cut(config): rule-enforcement.json moves to fleet-ops", Nishfleet/
fleet-ops#7952 added it unedited there; #7953 tracks reconciling the 103/129
dead-enforcer entries — the ~line-320 pointer among them). So each enumerated
artifact no longer exists in this repo; the pointer is removed, not repointed.

## What this lane changed (eff28af46, then the review follow-up commit)

Residual LIVE prose on main that still described auto-revert as an active
mechanism, corrected to name the actual undo mechanism after the deletion:

- `app/lib/creative-r2-hash.server.ts` header comment: "nothing here can break
  an auto-revert" → "…break a rollback to a previous deploy" (matches the
  post-#3679 mechanism; comment-only, no code surface).
- `docs/ci-gates-ledger.md`: R4 row now cites `wrangler rollback` in
  deploy-production.yml + `git revert` since auto-revert.yml was deleted
  2026-09-20; the auto-revert.yml gate row struck with the removal record; the
  "#3070 next-auditor" note marked superseded (classifier + test pin deleted
  with the files); clean-record table row annotated "removed later the same
  day".
- Review follow-up (same file, same defect class): the pre-existing
  present-tense rows claiming `auto-revert.yml` cover(ed) red main (the
  red-on-main-watch and stop-the-line-watch removal rationales, and the
  "Re-enabled (3)" header) re-anchored to past tense with the current
  coverage: deploy workflow's smoke failure + `wrangler rollback`, and a
  person + `git revert` for a genuinely broken commit on main.

## Review (reviewer agent, this worktree)

`ACCEPTANCE: satisfied` — findings 1/2 files deleted at 5d19b38e0; finding 3's
pointer removed from this repo by the 5101c77b4 cut (reconciliation tracked as
fleet-ops#7952/#7953). No Critical. Factual ledger claims verified against
5d19b38e0 (262-line workflow + 200-line test deleted, ancestor of origin/main)
and deploy-production.yml:137 (`npx wrangler rollback --yes` on failed smoke,
comment block 139–147 declaring itself the whole replacement).

Out-of-scope follow-ups filed as NEW issues (plain, no labels):
- #3840 — `[market-signal-snapshot-age.yml:11]` — "Alert shape (matches
  auto-revert.yml)" names a deleted file as if live.
- #3841 — `[dependabot-auto-arm.yml:19]` — "(this is the auto-revert contract …)"
  keeps a dead workflow's name as live-sounding vocabulary; described
  invariant still true.

## Verification (real runs)

- `npx vitest run --configLoader runner --project node --changed origin/main
  --reporter=dot`: 46 files, 392 tests, all passed (workingtree green at
  22:03–22:05 UTC+05:30 local run).
- Explicit: `tests/docs-cite-real-paths.test.ts` +
  `tests/creative-r2-hash.server.test.ts` + `tests/ad-persistence-ratchet.test.ts`
  → 3 files, 33 tests, all passed.
- After review follow-up upgrade: `tests/docs-cite-real-paths.test.ts` +
  `tests/lane-evidence-collision.test.ts` → 2 files, 12 tests, all passed.
  `git diff --check` clean.

## No-mechanism note

The issue is prose correction; acceptance is met by corpus truth-up, no new
detector/gate applies. (`mechanism-impossible` irrelevant — nothing mechanical
was asked.)
