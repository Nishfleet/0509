# Issue #1665 — `0509-digest-headline-ratio-guard.service` failed (system scope) since 2026-09-05T12:41Z

## Outcome: already resolved — root cause fixed by #1660's merged PRs, re-verified live

The alert auto-filed this issue when the system-scope unit entered failed state
at 2026-09-05T12:41:40Z. The underlying defect was tracked and fixed under
issue #1660 (`npm: command not found` in the root service PATH), which merged
before this lane ran:

- PR #1671 (merged 2026-09-05T16:45:52Z) — `ops/digest-headline-ratio-guard/provision-digest-headline-ratio-guard.sh`
  resolves the node bin dir and the unit template carries an explicit
  `Environment=PATH=__NODE_BIN_DIR__:/usr/local/bin:/usr/bin:/bin`.
- PR #1673 (merged 2026-09-05T16:59:50Z) — the resolver now picks the bin dir
  containing both `node` and `npm`.
- `tests/digest-headline-ratio-guard-provision.test.ts` locks the installed
  unit's `Environment=PATH` shape so the regression cannot silently return.

## Live verification at claim time (2026-09-06T07:50Z)

- `systemctl is-failed 0509-digest-headline-ratio-guard.service` → `inactive`
  (not failed).
- `systemctl is-active 0509-digest-headline-ratio-guard.timer` → `active`
- `journalctl -u 0509-digest-headline-ratio-guard.service --since -3d` (recent runs):
  `verdict: ok — headline ratio at/above the 50% guard floor.` (multiple runs)
- `systemctl --failed` → `0 loaded units listed` (no system-scope failures).
- Installed unit `/etc/systemd/system/0509-digest-headline-ratio-guard.service`
  carries `Environment=PATH=/home/nish/.local/bin:...` (provision substitution
  applied) plus the `path.conf` drop-in added during incident response — the
  deployed unit matches the post-fix repo template.

## Why no code change

The issue body asks to repair the root cause and prove exit 0. Both were
already delivered by #1660's merged PRs and the applied host fix; this lane
re-verified the acceptance chain live rather than duplicating the work.
Sibling alert issues filed for the same root cause (#1659, #1662, #1670) are
covered by the same fix.
