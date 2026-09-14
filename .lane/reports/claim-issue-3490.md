# Lane report — claim/issue-3490

Issue: Nishfleet/0509#3490 — `sibling guard-provision tests depend on ambient
node/npm co-location (same flake class as #3478)`.

Diff: `origin/main...HEAD` = one commit, `21fc7e3d9`, touching exactly
`tests/proof-metric-guard-provision.test.ts` and
`tests/digest-headline-ratio-guard-provision.test.ts`. PR #3510.

## What was done

Applied the fixture-HOME pattern from
`tests/sitemap-coverage-guard-provision.test.ts` (#3415 follow-up) to both
sibling provision drills: `realBin()` discovery, `fixtureHome()` (decoy lone
node in `$HOME/.local/bin`, real node+npm pair in `$HOME/bin`), and
`resolveGuardPath()` spawning the provision script's `--resolve-path` with
`HOME` pointed at the fixture. Assertions strengthened from host-dependent
regex to exact deterministic output (`${pairDir}:/usr/local/bin:/usr/bin:/bin`).
`tests/proof-metric-guard-provision.test.ts` also gained the third drill
("picks a node bin dir containing BOTH node and npm executables") that digest
already had, restoring line-for-line sibling parity. No product code touched.

## Acceptance proof (run live on netcup-rs2000, 2026-09-15)

1. **Siblings pass with HOME pointed at the fixture** — targeted run:

   `npx vitest run --configLoader runner --project node tests/proof-metric-guard-provision.test.ts tests/digest-headline-ratio-guard-provision.test.ts tests/sitemap-coverage-guard-provision.test.ts --reporter=dot`

   ```
   Test Files  3 passed (3)
        Tests  17 passed (17)
   ```

2. **Still pass on a host whose ambient node/npm dirs are split** — simulated
   the #3478 host shape: two fresh dirs, `node` symlinked in the first,
   `npm`+`npx` in the second, prepended to `PATH` (verified `command -v node`
   and `command -v npm` resolve to different dirs; `npm --version` works
   through the symlink). The same 3-file run under that split `PATH`:
   **17/17 green**. The fixture's `$HOME/bin` pair wins over the ambient
   `dirname(node)` candidate because both provision scripts order
   `$HOME/bin` first, so the pick is host-independent.

3. **The old code fails the same host shape** (the flake this issue exists
   for) — old invocation = `--resolve-path` with ambient (no fixture) `HOME`
   whose `.local/bin` holds a lone node and no `bin/`, plus the split `PATH`:

   ```
   proof-metric-guard provisioning error: could not resolve node/npm on PATH
   exit=1
   digest-headline-ratio-guard provisioning error: could not resolve node/npm on PATH
   exit=1
   ```

   The old tests asserted `status === 0` on exactly this invocation, so they
   go red on a split host; the fixture version stays green.

4. **Repo gate** — `npx vitest run --configLoader runner --project node
   --changed origin/main --reporter=dot`: 2 files, 10 tests, green. (CI owns
   typecheck per AGENTS.md; no lint script exists in package.json.)

## Review adjudication (reviewer seat, read-only pass over the diff)

- **Missing lane evidence record** — Act on: this file is the fix (committed
  with `git add -f` per AGENTS.md).
- **No tmpdir cleanup in `fixtureHome()` (12 dirs/run across the family)** —
  Noted: faithful to the sitemap reference (same wart there); fix belongs in
  all three files at once as a shared-pattern change, not a drive-by in this
  PR. Candidate follow-up if the family grows.
- **Third proof-metric test is logically subsumed** — Dismissed with reason:
  exact sibling parity with digest/sitemap has review value; redundancy is
  deliberate.
- **"stale-binary" comment wording** — Dismissed with reason: mirrors the
  sitemap reference wording verbatim; the surrounding text states the actual
  contract (lone node without npm is skipped).
- **Extract shared `tests/helpers/fixture-home.ts`** — Dismissed with reason:
  three copies of ~20 lines is not worth new machinery; only if the family
  grows again.

## Verdict

Acceptance met on both legs, proven live; reviewer pass clean of critical
findings. Ready to land via PR #3510.
