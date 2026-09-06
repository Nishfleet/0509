## Why
#1800 (the first FleetMainRed of 2026-09-06, opened 11:50:56Z) is resolved on main but still open: the PRs that did the work (#1826 root-cause fix, #1827 collateral restore) did not carry `Closes #1800`. This PR records the incident and its resolution in the canonical incident log (`docs/PROJECT-HISTORY.md`) so the close is attributable to a real diff, not a bare `gh issue close`.

## What happened
- FleetMainRed opened 2026-09-06T11:50:56Z with `fleet_main_ci_green[Nishfleet/0509]=0`; the other 8 enrolled repos were green. The failing required check was **Secret Scan (Gitleaks)** on the `push` event: the scan step ran a bare `gitleaks git .` = `git log --all`, walking every fetched ref. A redaction-test fixture (`api_key=...` at `tests/release-hydration-bridge.test.ts:95`, commit `b884832f`) that lived **only on an unrelated open claim branch** (`claim/issue-1752-refresh`, PR #1810) poisoned main's required scan. Main's own history scanned clean. The same class re-fired at 14:10Z as #1814 (recorded in detail in the existing **#1814 main CI red** entry below).
- The `.gitleaksignore` fingerprint PRs (#1805/#1819/#1820) treated only the symptom.

## Resolution (already merged)
- **#1826** (`orch/secret-scan-push-scope`, merged 2026-09-06T15:05:51Z, commit `1a41f0a1`): scoped `push`/`workflow_dispatch` scans to `--full-history HEAD` (main ancestry only, never `--all`); `pull_request`/`merge_group` keep `base..head`. Added `tests/secret-scan-workflow.test.ts` pinning every event sets an explicit scope, no bare `log_opts=()`, no `--all`. Kills the cross-branch whack-a-mole class.
- **#1827** (`orch/reland-1787`, merged 2026-09-06T15:08:04Z, commit `6b0e0c0c`): restored the innocent #1787 docs reverted by the false-positive-triggered auto-revert #1817. Sequenced after #1826.

## Scope of this PR
- `docs/PROJECT-HISTORY.md`: one new entry under `## 2026-09-06`. No product code, schema, route, or workflow changed.

## Verification
```
vale --config=.vale.ini docs/PROJECT-HISTORY.md
# ✔ 0 errors, 0 warnings (32 suggestions, none gate-failing) in 1 file.
```
run-proof: main CI green — `gh api repos/Nishfleet/0509/commits/main/check-runs` (2026-09-06T15:48Z, head `225f8f4a`): every completed check `success` or `skipped`, zero failures; Secret Scan green on the post-fix main heads (`1a41f0a1` run 34041230067, `49638a83`, `225f8f4a`); `fleet_main_ci_green{repo="Nishfleet/0509"} = 1` on the live exporter. The #1800 incident is the same class already proven green in the #1826/#1831 record.

research: n/a — incident record only, no new mechanism.
help-first: n/a — docs-only entry in the existing `docs/PROJECT-HISTORY.md` log (same pattern as #1831).
organ-heartbeat: docs/PROJECT-HISTORY.md not-an-organ: history log, no running mechanism touched.
loose-ends-canary: none — fix (#1826) and collateral restore (#1827) both merged; this PR closes the open issue.

Closes #1800


## Review
Reviewer seat: cursor/cursor-grok-4.6-high (senior ladder, resolved via `find_senior_seat`).
Reviewer round on `origin/main...HEAD` (docs-only diff): no Act-on findings; no Consider findings. Two Noted nits:
- `opened 2026-09-06T11:50:56Z` is the FleetMainRed alert time, not the GitHub issue createdAt (13:30Z) — consistent with the identical house convention used in the #1814 entry below (14:10Z alert vs 14:30Z createdAt), so kept as-is.
- Reviewer cautioned that the close depends on an auto-close keyword; confirmed the PR body ends with a standalone `Closes #1800`, so merge auto-closes the issue.
All factual claims (fix merge time/commit `1a41f0a1`, workflow scope change, fixture commit `b884832f` line 95, symptom PRs #1805/#1819/#1820, collateral restore #1827, #1814 re-fire) verified 1:1 against the live merged record. Vale 0 errors.
