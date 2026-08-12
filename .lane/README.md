# Lane evidence convention

Every lane evidence record is its own file under `.lane/reports/`. One record
per PR; one PR touches exactly one new record file; no two open PRs ever edit
the same path.

## Rules

1. **Create, never append.** A lane records evidence by adding a NEW file
   `.lane/reports/<kebab-slug>.md` in its PR — one file per record, named with
   a short kebab-case slug for the item (for example
   `anonymous-search-60s-cap-honest-end.md`). Never append a second record to
   an existing file, and never edit a file another PR owns.
2. **`.lane/report.md` is frozen.** It is a historical index of migrated
   records. Do not edit it: CI fails any PR that grows or rewrites it. Only
   net-removing migrations (records moved out into `.lane/reports/`) pass the
   gate.
3. **Claim a fresh slug.** Before opening a record PR, check the open PRs
   touching `.lane/reports/` and pick a slug nobody else holds. The CI gate
   enforces this: the first PR to claim a slug owns it, and a second writer
   fails.
4. **Record PRs stay docs-only.** A record PR changes exactly one new file
   under `.lane/reports/`. If the item needs code, land the code PR first and
   record the evidence in a separate record PR.

## Why

`.lane/report.md` was a single tracked file every lane appended to. On
2026-08-12, 25 of 61 open PRs edited it and ~20 were merge-conflicted
(DIRTY/BLOCKED) purely from colliding appends. Per-record files make the
collision impossible by construction: a brand-new file can never conflict with
any other open PR, and the gate in `.github/workflows/lane-evidence-gate.yml`
keeps it that way.
