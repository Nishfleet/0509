# Lane evidence — claim/issue-1728 (Vale 3.20.0 content-quality gate + ratchet)

Issue: Nishfleet/0509#1728 — "Upgrade to Vale 3.20.0; restructure AI-slop
deny-list as extends: Std.AISlop + project child rule; add
SentenceLength[max] parameter tuned by quality ratchet". Source: quality-
research-weekly sweep 2026-09-06 §3. Orchestrator decision (issue comment,
fable-fleet-check 2026-09-06T03:03Z): Option 1, ratchet-from-reality — seed
the ceiling at the tree's measured maximum, vendor the Std package, put the
check in a new workflow file, tighten weekly via direct-to-main commits.

## Acceptance-criteria mapping

| Issue bullet | Implementation |
|---|---|
| Install Vale 3.20.0 in CI | `.github/workflows/content-quality.yml` downloads the pinned `vale_3.20.0_Linux_64-bit.tar.gz` release asset and verifies its sha256 before use. |
| `.vale/styles/Std/AISlop.yml` base deny-list | Vendored upstream `vale-cli/Std` package (MIT; LICENSE + NOTICE carried in-tree, rule files verified byte-identical to upstream `main`) plus `Std/AISlop.yml` holding the deny-list drawn from the Wikipedia "Signs of AI writing" list and tbhb/vale-ai-tells v1.31.0 word-lists. |
| `House/AISlop.yml` child + vocab | `.vale/styles/House/AISlop.yml` uses `extends: Std.AISlop` with `tokens-` for domain vocabulary (harness*, navigate*) and `tokens+` for project-specific tells. `Std.AISlop = NO` in `.vale.ini` reports each hit once via the child. False-positive overrides live in `.vale/styles/config/vocabularies/House/accept.txt` — the path Vale 3.20.0 resolves for `Vocab = House` under `StylesPath = .vale/styles`. |
| `.vale.ini` settings | `BasedOnStyles = Std, House` under `[*.md]` (it is a syntax-specific option — top-level placement is a config error, verified with the binary). `Std.Readability.SentenceLength = error` and `Std.Readability.SentenceLength[max] = 176`, seeded at the measured tree maximum instead of the spec's literal 30 per the orchestrator's ratchet-from-reality decision. |
| Whole-tree error gate | `vale --minAlertLevel=error --counts .` runs on `pull_request`, `merge_group`, `push` to `main`, and `workflow_dispatch` — whole tree every run, never diff mode. |
| Weekly quality ratchet | `scripts/quality-ratchet.mjs` re-measures the longest sentence with the real Vale binary and lowers the ceiling monotonically (floor 30, the spec's asymptote); `.github/workflows/quality-ratchet.yml` runs it weekly plus on dispatch and commits tighten-only changes to main, mirroring `ratchet-auto-tighten.yml`. |

## Deviations and why

- `SentenceLength[max]` seeds at 176, not 30: the tree's longest measured
  sentence is 176 words and 1,563 sentences exceed 30 across 221 files. The
  orchestrator approved seeding at the measured maximum so the gate is green
  on day one; the weekly job lowers it as the tree improves.
- The Std package is vendored, not synced: `vale sync` deletes hand-authored
  files inside a package directory (verified live by the proposing worker),
  which would wipe the committed `Std` tree on every sync.
- `accept.txt` is case-sensitive and matches whole tokens only, so the
  word-families that are pure domain vocabulary moved to `tokens-` (one
  entry clears every case form) while individual deny-listed terms with
  legitimate corpus use sit in `accept.txt`.
- One real slop instance was edited rather than whitelisted: `nuanced` in
  DESIGN.md became `subtle`.
- `quality-ratchet.yml` pushes with an explicit `x-access-token` remote URL
  because `persist-credentials: false` checkouts leave git with no
  credentials; the same step in `ratchet-auto-tighten.yml` would fail if its
  push path were ever exercised (no `chore(ratchet)` commits exist on main).
  Filed as Nishfleet/0509#1758.

## Verification

- `vale --minAlertLevel=error --counts .` on the worktree → `0 errors, 0
  warnings, 0 suggestions in 306 files` (exit 0).
- `vale --output=JSON --no-exit .` with `max = 30` → 1,563 alerts across 221
  files, maximum 176 words — the seed value.
- `node scripts/quality-ratchet.mjs` → "ceiling 176 holds; measured 176"
  (exit 0). `--update` → no-op (exit 0). Ceiling raised to 200 → tightened
  back to 176 (exit 0). Ceiling lowered to 100 → refused to raise, file
  untouched (exit 2).
- `npx vitest run tests/quality-ratchet.test.ts --project node` → 9/9 pass,
  including the newline-preservation case the first regex broke.
- `actionlint` on both new workflow files → clean.
- Child-rule behaviour verified on a fixture: `extends` fires parent tokens,
  `tokens+` adds, `tokens-` removes across case forms, `accept.txt`
  suppresses listed terms, and a bogus flag (`--definitely-bogus-flag`)
  errors with exit 2 while `--counts` is accepted.
