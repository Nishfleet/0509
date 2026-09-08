## What

Narrow the `gate-integrity` gate-weakening scan so dependency lockfile CONTENT is exempt from its content rules. A Dependabot bump rewrites only the lockfile, whose machine-generated version/integrity text can coincidentally resemble a skip marker, an assertion, or a softened CI step (e.g. `@babel/helper-skip-transparent-expression-wrappers`, `"integrity": "sha512-..."`, or `|| true` in `pnpm-lock.yaml`, which the CI_SOFTENER rule actually scans). Exempting lockfile content up front makes a lockfile-only PR structurally immune to a false positive regardless of how the content patterns evolve.

This is a narrowing, never a relaxation. The filename-level suite-integrity and gate-path rules still run on every file, including lockfile paths — a test renamed to a lockfile name is still caught. The negative control and the rename-bypass fixtures prove the gate still blocks real test removal.

## Honest finding on the issue premise

The issue reports that lockfile-only Dependabot PRs (#1579, #1543, #1589) fail `gate-integrity`. I verified this against live data: **they do not**. All three pass `gate-integrity` on main today (latest runs SUCCESS). A root `package-lock.json` is neither a test path nor a gate path, so none of the content rules fire on it — `package-lock.json`/`yarn.lock` diffs never false-positive today. The one content rule that CAN fire on a lockfile is the CI_SOFTENER `.yaml` scan on `pnpm-lock.yaml`.

The real blocker for those PRs is the `arm` check: `AUTO_REVERT_PAT is not configured` on Dependabot-triggered runs (GitHub does not expose repo secrets to Dependabot-triggered workflows). That is a separate defect, filed as **#1948**.

So this change is mostly defensive hardening that makes the existing immunity explicit and durable, plus the one genuine fix: `pnpm-lock.yaml` is now exempt from the CI_SOFTENER scan, which is the only real false-positive a lockfile could trip on main.

## Verification

- `bash .github/scripts/test-gate-integrity.sh` → **75 passed, 0 failed** (was 70; +5 new fixtures).
- New fixtures:
  - `lockfile_only_bump` — #1579's exact 3-line diff → PASS.
  - `lockfile_skip_like_text` — #1589's skip-like/integrity text → PASS.
  - `lockfile_pnpm_ci_softener` — `pnpm-lock.yaml` with `|| true` → PASS. This is the genuine pin: it FAILS on main and PASSES with the exclusion (verified against both scripts).
  - `lockfile_rename_bypass` — a test renamed to `package-lock.json` → FAIL (the gate still catches test removal through a lockfile name).
  - `lockfile_negative_control` — real `it.skip(` in a test file, no trailer → FAIL (gate still blocks).
- Cross-checks against the OLD (main) script: pnpm `|| true` FAILs on main, PASSes with the exclusion; a test renamed to a lockfile FAILs on both old and new — the guard holds.

run-proof: fixture regression `test-gate-integrity.sh` (75/75 green).

## Gate-path change

This PR edits `.github/scripts/gate-integrity.sh` and `.github/scripts/test-gate-integrity.sh`, which are gate-owned paths. Per the gate-integrity rule, I do not post the attestation comment myself; a repository admin must post `gate-integrity-attest: <head sha>` for this PR to pass the gate.

Closes #1947

## Reviewer round (1 of 1)

Reviewer seat: cursor/cursor-grok-4.6-high (senior, resolved via find_senior_seat).

### Act on
- `gate-integrity.sh` — the prior draft placed a blanket `continue` at the TOP of the per-file loop, before the filename-level test/gate checks. That let a test silently leave the suite by being renamed to `package-lock.json` (`tests/auth.test.ts` → `package-lock.json` PASSed). Moved the exclusion to fire only on the content scan (after the filename-level checks), so deletion / rename-out / gate-path rules still run for lockfile paths. Verified: the rename-bypass now FAILs (old and new scripts agree); pnpm `|| true` still PASSes.
- `gate-integrity.sh` — dropped the `prev` clause. Renames FROM a lockfile to a real test/gate path still surface via the current `filename`, so the exclusion stays to the narrowest surface.
- `test-gate-integrity.sh` — added `lockfile_pnpm_ci_softener` (the one case that genuinely fails on main and passes with the exclusion) and `lockfile_rename_bypass` (pins the guard so a future edit cannot widen the skip into a test-removal mask).

### Consider
- The CI_SOFTENER rule treats `bun.lock` as a lockfile in `review-gate.yml` but the new `LOCKFILE_PATH` regex only lists `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`. These two lists can drift. Noted — `bun.lock` diffs are out of scope for this npm-Dependabot issue, but the divergence is flagged here.

### Noted
- The change does not fix an active gate-integrity failure on a root `package-lock.json` — those already pass on main. The `pnpm-lock.yaml` CI_SOFTENER exemption is the genuine behavior change; the rest is durable hardening. The real blocker for the Dependabot PRs is the arm/AUTO_REVERT_PAT issue (#1948).

### Dismissed
- The prior body dismissed the rename-to-lockfile bypass as "not a realistic bypass — renaming a test to package-lock.json would break the build." The senior reviewer demonstrated it is a real gap in the blanket-`continue` draft, so it was elevated to Act on and closed with the restructure above, rather than dismissed with reason.
