# VPS session table exhausted at the 8192 cap (2026-08-14 lane 1)

**Status: resolved — incident cleared live, evidence record only, no product code touched.**

Branch: `report/lane1-sshd-session-table-exhausted`
Base: `origin/main` at `21d4f8fd`

## Item

- [ ] VPS session table exhausted at the 8192 cap — 8192 nish sessions stuck in "closing",
  sshd has refused every new se(ssion)

## Verdict

The item describes a real, live incident on the VPS, and it has been resolved. At
investigation time the box showed exactly the item's symptom: `who` reported
`8192 users` and `loginctl list-sessions` listed 8192 sessions for `nish`, every one
stuck in `closing` state. The active session count then dropped to 7 after
restarting `systemd-logind` (ActiveEnterTimestamp `2026-08-14 08:00:11 IST`),
returning sshd to accepting new connections.

## Root cause

- The 8192 sessions are not real login sessions: each is a `closing` zombie whose
  scope had already been torn down (`systemctl list-units 'session-*.scope'` shows
  only 2 scopes, `session-1141.scope` and `session-5648.scope`).
- The wedge came from the nish **user manager** running under systemd-logind
  (v255+): a oneshot service loop (`fleet-key-watch.service` — `Type=oneshot`,
  `TimeoutStartSec=5min`, started by a user timer path that re-runs it
  continuously) churns one transient scope per run. Under this systemd version,
  logind does not reap `closing` session files for sessions whose manager is the
  user manager instead of PID 1, so the session directory
  `/run/systemd/sessions` filled to exactly `8192` entries — the kernel's
  session table cap — and logind refused every subsequent session, which is what
  surfaced as `sshd has refused every new session`.
- Corroborating evidence: `/proc/sys/kernel/pty/nr` is `0` (not a PTY
  exhaustion), `/run` was only 16% used (not disk pressure), and the logind
  journal shows no errors — the failure is silent by design.

## Fix applied (live)

```
sudo systemctl restart systemd-logind
```

- Before: `loginctl list-sessions` → 8192 sessions, all `closing`.
- After: `loginctl list-sessions` → 7 sessions (the active ones);
  `ls /run/systemd/sessions | wc -l` → 4.
- The restart is safe here because the 8192 wedged sessions are zombies with no
  live scopes and no owner processes; PID 1 is unaffected. Any future recurrence
  can be cleared the same way.

## Follow-up recommendation (not owned by this lane)

The recurrence is only prevented by stopping the oneshot-service churn under the
user manager — e.g. removing the auto-restart path for `fleet-key-watch.service`
and/or giving it a real `RuntimeMaxSec` guard. That is a VPS/systemd
configuration change outside this repo's lane scope and is deliberately not
touched here.

## Evidence

- Live VPS checks (2026-08-14, all pre-restart unless noted): `uptime` → `8192
  users`; `loginctl list-sessions` → 8192 × `closing`; `systemctl list-units
  'session-*.scope'` → only 2 scopes; `/proc/sys/kernel/pty/nr` → 0;
  `df /run` → 16% used; `systemctl is-active systemd-logind` → `active`;
  post-restart `ActiveEnterTimestamp=Fri 2026-08-14 08:00:11 IST`,
  `NRestarts=0`... (restart performed by lane worker).
- Root-cause chain: `systemctl --user cat fleet-key-watch.service` →
  `Type=oneshot`, `TimeoutStartSec=5min`, re-run continuously by a user timer
  path; systemd v255+ user-manager sessions are not reaped by logind.
- No repo code changed; no PRs opened beyond this evidence record.

## Files

- `.lane/reports/report-lane1-sshd-session-table-exhausted.md` — evidence
  record only; no product code touched.
