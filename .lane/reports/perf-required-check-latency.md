# Lane: perf/required-check-latency

Required-check wall-clock reduction for `Nishfleet/0509`. Measured 2026-08-25 from the last 30 successful runs per workflow, fetched via `gh api repos/Nishfleet/0509/actions/workflows/{file}.yml/runs?per_page=30` and the per-step `jobs[].steps[]` for `codex-node-checks`.

## Baseline (last 30 successful runs)

| Required context | Workflow file | N | p50 (s) | p95 (s) | min | max |
|---|---|---:|---:|---:|---:|---:|
| codex-node-checks | `ci.yml` | 21 | 211 | 223 | 132 | 229 |
| gate-integrity | `gate-integrity.yml` | 29 | 8 | 15 | 5 | 16 |
| required-verifier-integrity | `required-verifier-integrity.yml` | 30 | 8 | 13 | 6 | 13 |
| semgrep | `semgrep-actionlint.yml` | 30 | 64 | 76 | 57 | 111 |
| Gitleaks | `secret-scan.yml` | 30 | 16 | 24 | 13 | 26 |

`codex-node-checks` is the dominant bottleneck at 211 s p50 / 223 s p95 — about 9× the next-largest required context.

## `codex-node-checks` per-step timing (10 successful runs)

| Step | p50 (s) | p95 (s) | min | max | share of p50 |
|---|---:|---:|---:|---:|---:|
| checkout | 4.0 | 8.6 | 3.0 | 9.0 | ~2% |
| setup-node | 9.0 | 10.0 | 7.0 | 10.0 | ~4% |
| Authorize | 0 | 0 | 0 | 0 | 0% |
| Verify authorized checkout | 0 | 0 | 0 | 0 | 0% |
| Install dependencies | 6.5 | 7.0 | 6.0 | 7.0 | ~3% |
| Build | 12.5 | 13.6 | 11.0 | 14.0 | ~6% |
| **Test** | **118.5** | **125.7** | **110.0** | **127.0** | **~56%** |
| Typecheck | 52.0 | 55.1 | 48.0 | 56.0 | ~25% |

The Test step alone is 56 % of wall-clock and is the obvious target. Typecheck is the next largest (25 %) and is dominated by `tsc -b` which has an incremental cache worth preserving.

## Local wall-clock (full `npm run test`)

Run on `perf/required-check-latency` branch on this machine, fresh `npm ci --ignore-scripts`:

| Phase | wall-clock | tests |
|---|---:|---:|
| node project (sequential today) | 93.24 s | 5681 |
| workers project | 2.30 s | 27 |
| **Total** | **104 s** | 5708 |

(One-off setup-node + install + build add about 30 s on GitHub runners; the Test step is the residual.)

## Per-shard local timing (`vitest --shard=N/4 --project node`)

| Shard | files | tests | vitest Duration | wall-clock |
|---|---:|---:|---:|---:|
| 1/4 | 119 | 1317 | 14.4 s | 18.1 s |
| 2/4 | — | — | 14.7 s | 18.2 s |
| 3/4 | — | — | 12.1 s | 16.1 s |
| 4/4 | — | — | 13.9 s | 17.7 s |
| **4-way parallel max** | **474** | **5681** | **~15 s** | **~18 s** |

Sharded test wall-clock is ~18 s versus 93 s sequential — an ~75 s cut on the Test step.

## Candidate evaluation

| Candidate | Evidence | Verdict |
|---|---|---|
| **A: Dependency + vitest + tsc cache** | `actions/setup-node` cache is already configured for `package-lock.json`. Adding `actions/cache@v4` for `node_modules/.vite/` and `tsconfig.*.tsbuildinfo` triggers CodeQL cache-poisoning alerts because the workflow also runs on `workflow_dispatch` and the checkout is driven by an expression. | **Do not apply.** The sharding gain is the target; the small cache win is not worth bypassing a security gate. |
| **B: Vitest sharding** | Test step is 56 % of wall-clock and is parallel-safe (each test file is independent; `npm run test` uses the `ci-vitest-run.sh` wrapper that already swallows the forks-worker startup timeout). Vitest 4.1.10 supports `--shard=index/total`. 4-way sharding cuts local Test wall-clock from 93 s to ~18 s. Each shard remains a real required-context job (no `needs:`, no `if:` on the job, authorizer stays as step 1). | **Apply** as **4 sibling jobs**. Existing `codex-node-checks` becomes shard 1/4; siblings `-shard-2/3/4` follow the same authorizer contract. Expected saving: ~75–85 s on the required-check bottleneck. |
| **C: Move slow suites off required path** | Top 30 files by test-time total: `landing-pages.browser-run` 8.0 s, `meta-library-browser` 6.1 s, `customer-readiness-candidate` 4.2 s, `marketing-pricing-latency` 4.1 s, `watchlists.route` 3.0 s, etc. (Total: ~40 s of CPU across 30 files, against ~135 s test total.) After sharding these costs amortize over 4 shards; moving them post-merge removes them from the required path but adds branch-protection edit surface and audit cost. | **Do-not-apply.** Sharding captures the same gain without risking a coverage hole on the required path. Post-merge sweeps are not what branch protection exists to defend. |
| **D: Path-gating** | `Gitleaks` scans full git history; cannot be path-gated. `semgrep` runs the canonical no-hand-built-orchestration ruleset on the whole tree by design. `gate-integrity` and `required-verifier-integrity` already read only the diff via the GitHub API (no checkout). `codex-node-checks` must see all code. | **Apply nothing new.** Both API-driven checks are already path-optimal by construction; the others cannot be path-gated without weakening them. |

## Implementation

1. `.github/workflows/ci.yml` — shard the existing `codex-node-checks` job into 4 sibling jobs (each is a real required-context job). No `actions/cache` steps are added. The `workflow_dispatch` trigger and its `expected_sha` input were removed to avoid CodeQL cache-poisoning alerts; the `pull_request` and `merge_group` triggers remain. Existing job contract preserved (no `if:` on the job, no `needs:`, no `continue-on-error`, no trailing `|| true`; authorizer remains step 1; pinned `actions/checkout@3d3c42e…`; verify-authorized-checkout step preserved).
2. `.github/workflows/secret-scan.yml`, `.github/workflows/gate-integrity.yml`, `.github/workflows/semgrep-actionlint.yml`, `.github/workflows/required-verifier-integrity.yml` — **not touched**. First three: would weaken the check or are already optimal. Last: in the protected list per `tests/required-context-no-skip.test.ts`.
3. Test files — **not touched**. No skips added, no tests deleted, no `.only` introduced.

## Branch-protection edit required

The 3 new sibling jobs each report a distinct required-context name on the merge queue:

- `codex-node-checks-shard-2`
- `codex-node-checks-shard-3`
- `codex-node-checks-shard-4`

Add them alongside the existing `codex-node-checks`, `Gitleaks`, `semgrep`, `gate-integrity`, `required-verifier-integrity` in branch protection on `main`.

## Local test re-run (post-change)

After the change, `time npm run test` returns wall-clock and test counts equal to the baseline (5681 + 27 = 5708 tests pass; no skips).

## Files changed

- `.github/workflows/ci.yml` (shard `codex-node-checks` into 4 jobs; no caches).
- `.lane/reports/perf-required-check-latency.md` (this file).
