# Lane evidence — claim/issue-1463

## Goal
Close Nishfleet/0509#1463 by adding `BreadcrumbList` JSON-LD and a visible breadcrumb nav to every programmatic surface outside `/ads/:domain`.

## Work performed
- Reused the existing `claim/issue-1463` branch which already contained the implementation commit `b4bb1e18`.
- Merged `origin/main` into the branch and resolved two merge conflicts:
  - `app/app.css` — kept both the new `.f9-breadcrumbs` block and the `origin/main` `.f9-rh-*` run-history styles.
  - `app/routes/capture-rules.tsx` — kept the new `<Breadcrumbs>` and the `origin/main` `FAQPage` JSON-LD + budget-skip rule block.

## Verification commands

```bash
NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck
# exit 0

NODE_OPTIONS=--max-old-space-size=8192 npx vitest run --configLoader runner --project node tests/breadcrumb-structured-data.test.tsx
# Test Files  1 passed (1)
#      Tests  10 passed (10)

NODE_OPTIONS=--max-old-space-size=8192 npm test
# node project: 551 files, 6597 tests passed
# workers project: 20 files, 114 tests passed

sgscan
# No new security findings.

fleet-wipe-lessons-check scan --root /home/nish/workspaces/agent-worktrees/issue-0509-1463
# fleet-wipe-lessons-check: scan clean

crgate --help
# CodeRabbit is not signed in on this machine. (skip)
```

## Result
- Branch `claim/issue-1463` is now up-to-date with `origin/main` and merge-conflict-free.
- PR Nishfleet/0509#1637 was updated and auto-merge armed.
