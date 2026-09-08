## What

Narrow the `gate-integrity` gate-weakening scan so dependency lockfiles are excluded from it. A Dependabot bump rewrites only the lockfile, whose machine-generated version/integrity text can coincidentally resemble a skip marker or an assertion (e.g. `@babel/helper-skip-transparent-expression-wrappers`, `"integrity": "sha512-..."`). Excluding lockfile paths up front keeps the scan from ever reading lockfile bytes, so a lockfile-only PR is structurally immune to a false positive regardless of how the content patterns evolve.

This is a narrowing, never a relaxation: every other path is still scanned exactly as before. The negative control fixture proves a real `it.skip(` in a test file with no `test-removal-justified:` trailer still fails.

## Honest finding on the issue premise

The issue reports that lockfile-only Dependabot PRs (#1579, #1543, #1589) fail `gate-integrity`. I verified this against live data: **they do not**. All three pass `gate-integrity` on main today (latest runs SUCCESS). The current decision script is already structurally immune to lockfile false positives, because lockfiles are neither test paths nor gate paths, so none of the content patterns fire on them.

The real blocker for those PRs is the `arm` check: `AUTO_REVERT_PAT is not configured` on Dependabot-triggered runs (GitHub does not expose repo secrets to Dependabot-triggered workflows). That is a separate defect, filed as **#1948**.

So this change is defensive hardening that makes the lockfile immunity explicit and durable against future pattern changes, plus fixtures that pin the behavior. It does not fix an active gate-integrity failure, because none exists.

## Verification

- `bash .github/scripts/test-gate-integrity.sh` → **73 passed, 0 failed** (was 70; +3 new fixtures).
- New fixtures:
  - `lockfile_only_bump` — #1579's exact 3-line diff → PASS.
  - `lockfile_skip_like_text` — #1589's skip-like/integrity text → PASS.
  - `lockfile_negative_control` — real `it.skip(` in a test file, no trailer → FAIL (gate still blocks).
- Real PR diffs #1579 and #1589 run through the decision script → PASS.

run-proof: fixture regression `test-gate-integrity.sh` (73/73 green).

## Gate-path change

This PR edits `.github/scripts/gate-integrity.sh` and `.github/scripts/test-gate-integrity.sh`, which are gate-owned paths. Per the gate-integrity rule, I do not post the attestation comment myself; a repository admin must post `gate-integrity-attest: <head sha>` for this PR to pass the gate.

Closes #1947

## Reviewer round (1 of 1)

Reviewer seat: minimax/MiniMax-M3 (senior ladder exhausted; fell through to capable seat).

### Act on
None.

### Consider
None.

### Noted
- The change does not fix an active gate-integrity failure — the three PRs already pass on main. This is defensive hardening; the real blocker is the `arm`/AUTO_REVERT_PAT issue (#1948). Already documented in the "Honest finding" section above.
- The `lockfile_skip_like_text` fixture's content does not trip the current `SKIP_MARKERS`/`ASSERTION` regexes, so it pins the exclusion rather than reproducing a live false-positive trigger. Consistent with the honest finding; kept as a regression pin.

### Dismissed
- `prev` exclusion asymmetry (renaming a test file to a lockfile path would skip it): not a realistic bypass — a test renamed to `package-lock.json` would no longer match `TEST_PATH` and would break the build. The `prev` check correctly handles lockfile renames.
