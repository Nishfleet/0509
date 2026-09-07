# Lane 3 report — CI runners: registered == real (2026-08-21)

**Item:** CI capacity is 3 real runners while 6 are registered (the 3
"0509-hardened-*" registrations are dead leftovers from the retired KVM
host) [scout 2026-08-12, risk: green] [ci-reliability]

**Status:** RESOLVED — registered capacity equals real capacity (3 == 3,
all online) as of this lane's live verification. The dead-registration
half was already closed operationally (registrations deleted ~2026-08-13)
and the pruner guard shipped in PR #690 (merged 2026-08-13). This lane
found and fixed one residual defect: the pruner script was tracked
non-executable, so its documented invocation failed with permission
denied.

## Verdict

The 6-vs-3 registered-vs-real discrepancy described in the item is gone.
The pruner guard now actually runs as documented.

## Live verification (2026-08-21 ~08:20Z)

- `gh api repos/Nishfleet/0509/actions/runners` →
  `total_count: 3`, exactly `netcup-rs2000-verify1/2/3`, all `status:
  "online"`. No `0509-hardened-*` entries remain; registered == real.
- Pruner dry run (after exec-bit fix): `./ops/github-runners/
  prune-dead-registrations.sh` →
  `no stale "0509-hardened-*" registrations found; fleet is clean`.
- Before the fix, `ops/github-runners/prune-dead-registrations.sh`
  failed with `Permission denied` (exit 126) because the file was
  tracked mode `100644`.
- Queue state at verification time: 0 queued, 2 in_progress, 28
  completed — no saturation at this hour. (Note: this only samples one
  quiet moment; the item's queue-saturation half was tracked separately
  by scouts and is not part of this lane's accept criteria.)

## Change shipped

- `ops/github-runners/prune-dead-registrations.sh`: mode `100644` →
  `100755` (executable bit), so the documented
  `ops/github-runners/prune-dead-registrations.sh [--apply]` invocation
  works. No content change.

## Evidence

- Commit `87e8612b` on branch
  `0509-lane3-ci-runners-registered-equals-real-20260821` (PR #807).
- This report: `.lane/reports/0509-lane3-ci-runners-registered-equals-real-20260821.md`
  (unique to this lane).

## Rollback

N/A — mode-only change to a guard script; no product code, data, or
runner configuration touched.
