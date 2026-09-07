## What

Migrate the 0509 CI gates that are safe to thin-call to fleet-ops reusables (issue #1098). This PR ships the one migration that is currently unblocked: `auto-merge-arm.yml` → thin caller of the fleet-ops `reusable-auto-merge-arm.yml`.

The reusable carries the same arming logic this file used to hold inline (draft / `no-auto-merge` / `[no-merge]` opt-outs, arming with `AUTO_REVERT_PAT` so a merge still triggers push workflows on main) and adds the stop-the-line freeze gate (fleet-ops#1457) and the quality-ceiling check (fleet-ops#3532) on top. Pinned to a fleet-ops main SHA, not `@main`.

## Audit results (per issue)

- **`review-gate.yml` → `reusable-review-gate.yml`: NOT migrated — blocked.** The reusable is not on fleet-ops main (P11-B re-land pending, fleet-ops#469). A thin caller pointed at a file that does not exist would break 0509 CI. Migrate when the re-land lands.
- **`auto-merge-arm.yml` → `reusable-auto-merge-arm.yml`: migrated here.** The issue said "add auto-enqueue.yml (new, no local equivalent)"; the audit found `auto-merge-arm.yml` IS the local equivalent, so adding a second arm would queue every PR twice. Convert the existing file instead.
- **`secret-scan.yml` → `reusable-gitleaks.yml`: NOT migrated — keep local.** The local version has extra hardness the generic reusable does not replace (required-context no-skip, repo-bound authorizer, `workflow_dispatch` SHA pin, fork PRs fail closed, pinned gitleaks binary + SHA-256).
- **`required-verifier-integrity.yml` / `gate-integrity.yml`: left alone** per the issue.

## Verification

- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/auto-merge-arm.yml'))"` → YAML OK; `jobs.arm.uses` = `Nishfleet/fleet-ops/.github/workflows/reusable-auto-merge-arm.yml@7a766ad9135f2c8bf6fa75e3c0bc56155bfcb723`; `secrets.AUTO_REVERT_PAT` passed explicitly.
- `git cat-file -e 7a766ad9135f2c8bf6fa75e3c0bc56155bfcb723:.github/workflows/reusable-auto-merge-arm.yml` → reusable exists at the pinned fleet-ops main SHA.
- Caller shape matches the canonical fleet-ops template `template/.github/workflows/auto-merge-arm.yml` (same `pull_request` trigger, `permissions: {}`, `concurrency`, `uses` + `secrets`).

## run-proof

- `reusable-auto-merge-arm.yml` is present on fleet-ops main at the pinned SHA `7a766ad9135f2c8bf6fa75e3c0bc56155bfcb723` (verified via `git cat-file -e`). The reusable is the live, already-shipped workflow this caller delegates to.

## Reviewer round

Reviewer seat: `commandcode` / `meta/muse-spark-1.2-contributor` (resolved via `find_senior_seat`).

- **Act on** — dropped `timeout-minutes: 5` on the arm job (the reusable declares no timeout; the caller can set one). Restored `timeout-minutes: 5` on the caller's `uses:` job.
- **Act on** — comment cited `#3532` without the `fleet-ops#` prefix. Fixed to `fleet-ops#3532`.
- **Noted** — the reusable's quality-ceiling step reads `github.workflow_sha` for its fleet-ops ref fetch; for a reusable workflow this context value is ambiguous. Not a defect in this diff (the caller correctly pins the reusable); the reusable is fleet-ops-owned and out of this PR's scope.

## Gate-path attestation required

This PR edits `.github/workflows/**`, so the `gate-integrity` check requires a repository admin to post a single-line comment:

```
gate-integrity-attest: <40-hex current head sha>
```

Nish: please post that attestation comment on this PR (same path as PR #1280). The worker that authored this PR must not attest.

Closes #1098
