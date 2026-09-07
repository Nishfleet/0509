# Deploy restore-evidence self-generation remediation

**Status: implemented; full test suite and typecheck green; PR open, not merged.**

Branch: `fix/deploy-restore-evidence-self-generate`
Base: `origin/main` at `b5bf3ce7`
Pull request: https://github.com/Nishfleet/0509/pull/545

## Problem

Deploy production failed 23 of the last 40 runs (runs 31278146322, 31224627211,
31275731092, ...) with `##[error]No valid pre-generated restore evidence is
available. Run the D1 remote restore evidence workflow in its recovery window,
then rerun this deploy.` The pinned-SHA restore-evidence gate accepted only
evidence artifacts produced by the separate `D1 remote restore evidence`
workflow (nightly 20:47 UTC drill or manual dispatch), which covers a single
main SHA per run. Every deploy of a migration-bearing or restore-critical main
commit between drills failed with `remote_restore_candidate_mismatch` until a
separate workflow ran at that exact SHA (verified in run logs: failures at
19:58/20:57 unblocked only after the 20:58 drill dispatch uploaded evidence).

## Fix

The exact-SHA safety gate is unchanged; the deploy no longer depends on a
separate workflow having run first.

- `scripts/ci-prepare-remote-restore-evidence.sh`: missing/stale/corrupt/
  non-matching evidence now reports `restore_evidence_available=false` and
  exits 0 instead of hard-failing; only tooling infrastructure failures
  (artifact lookup/download/verifier, exit 2) still stop the deploy. Packaging
  failures fall back to fresh generation.
- `.github/workflows/deploy-production.yml`: new `generate_restore_evidence`
  job runs the same drill as the nightly workflow (fresh GitHub-hosted runner,
  protected `production` environment, same approval markers, provider-lane
  acquire/release, archive/upload) at the exact pinned SHA; new
  `cleanup_restore_evidence` job deletes every run-scoped scratch database
  including from a hard-killed generation attempt; the protected `deploy` job
  proceeds only after the generated evidence passes the same exact verifier
  and cleanup succeeded. Fast path (verified pre-generated artifact) skips
  both new jobs.

## Verification

- Full Vitest: 421 files, 4772/4772 passed.
- `npm run typecheck` (wrangler typegen + react-router typegen + tsc -b): passed.
- `git diff --check`: clean.
- Behavioral tests now lock: missing/corrupt/expired/oversized/publish-failure
  evidence exits 0 with `restore_evidence_available=false` and no archive;
  infrastructure failures still exit 2; workflow tests lock the
  generate/cleanup wiring and deploy gating.

## Follow-up: direct-needs wiring defect found and fixed

Post-push review found one genuine wiring defect in the original workflow
change. `prepare_remote_restore_evidence` declared its `backup_proof_status`
output as `${{ needs.authorize_release.outputs.backup_proof_status }}` while
its `needs` list contained only `pin_candidate`. GitHub Actions exposes only
direct dependencies in a job's `needs` context: an empirical probe workflow
(job c needing only job b, reading `needs.a.outputs.val`) ran on GitHub and
printed `transitive_need_a=` (empty), while the direct reference printed
`direct_need_b=required`. A transitive reference therefore evaluates to an
empty string at runtime, which would have made the new
`generate_restore_evidence` / `cleanup_restore_evidence` jobs silently skip
their `backup_proof_status == 'required'` conditions and left the missing-
evidence deploy hard-failing at the deploy job's own verification — the exact
failure this lane removes.

Fix: the output now reads `${{ needs.pin_candidate.outputs.backup_proof_status }}`
(`pin_candidate` is a declared direct dependency and carries the identical
value from `authorize_release`). A regression test now parses
`deploy-production.yml` and asserts every `needs.<job>.` reference in every
job names a declared direct dependency; it failed first against the broken
wiring (`prepare_remote_restore_evidence ... undeclared: authorize_release`)
and passes on the fix.

Verification on this tip: full Vitest 421 files, 4773/4773 passed (new
regression included); `npm run typecheck` passed; `git diff --check` clean.

---
