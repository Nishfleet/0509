# claim/issue-3875 — residual hardening for the sorts-last migration gate

Follow-up to #2507 / PR #3873 reviewer round. Two defence-in-depth items.

## Change

`tests/check-migration-numbering.test.ts`: added a rename-detection pass to
`checkMigrationNumbering`. The A-side diff deliberately runs `--no-renames`,
which decomposes a `git mv` into D+A and loses the link between old and new
paths — so a rename onto a *strictly higher* number passed the gate looking
like a legitimately new migration. The second pass runs
`git diff --name-status --diff-filter=R --find-renames <merge-base>...HEAD`
unscoped and flags every rename whose **source** is a `migrations/*.sql` file
on the base branch. Files moved *into* `migrations/` from elsewhere in the
repo are not ledger entries and stay on the numbering path.

`tests/migration-numbering-workflow.test.ts` (new): structural guard in the
style of `tests/required-context-no-skip.test.ts` — parses `ci.yml` and fails
if the `Check migration numbering` step disappears from the required
`codex-node-checks` job, grows an `if:`/`continue-on-error`, stops targeting
the gate file, or the gate file itself vanishes. Without it, deleting the
step fails nothing: the gate file would only block a merge when shard 1 (the
one required shard) happens to collect it.

## Decision: renames flagged outright, not pinned-to-number

The issue offered "pin renames to keep their original number, or a separate
ledger check". Neither is quite right:

- **Pin-to-number is too weak.** `d1_migrations` records applied migrations by
  *filename*, not by number. `0088_a.sql` → `0088_b.sql` keeps the number but
  still re-keys the ledger — wrangler would apply `0088_b.sql` again or fail
  the deploy on the missing applied name. Same-number renames were already
  offenders via the A-side check anyway (number <= baseTop).
- **A separate ledger check is too big.** Knowing which migrations are applied
  needs `wrangler d1 migrations list --remote` — production state at PR time,
  out of scope for a stateless pre-merge gate and already the deploy-side
  sibling's job.

So the gate flags *every* rename whose source is a `migrations/*.sql` on the
base branch, including rename-out-of-directory. A base-branch migration may be
applied to production; the only safe answer is "add a new migration instead".

## Verification

- `npx --no-install vitest run --configLoader runner --project node
  tests/check-migration-numbering.test.ts
  tests/migration-numbering-workflow.test.ts` — 19/19 pass (14 gate + 5 guard)
- `npx --no-install vitest run --configLoader runner --project node --changed
  origin/main` — affected-tests mode, 19/19 pass
- `semgrep --config p/default --baseline-commit "$(git merge-base HEAD
  origin/main)" --quiet --metrics=off` — clean
- New scratch-repo cases: rename onto higher number fails naming
  `renamed from:`; same-number rename fails as a rename (not stale number);
  move-out-of-`migrations/` fails; move-into-`migrations/` at a top number
  passes as a normal add.
