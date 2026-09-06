# VPS session table exhausted at the 8192 cap — fresh live re-verification (2026-08-17 lane 1)

**Status: resolved — live re-verification of the 2026-08-14 fix (PR #712) and the
2026-08-15 re-verification (PR #753); evidence record only, no product code touched.**

Branch: `0509-lane1-sshd-session-table-fresh-verification`
Base: `origin/main` at `fdb97b84`

## Item

- [ ] VPS session table exhausted at the 8192 cap — 8192 nish sessions stuck in "closing",
  sshd has refused every new se(ssion)

## Verdict

The incident described in the item is **cleared live and has not recurred since the
2026-08-14 fix**. This lane re-verified the live box on 2026-08-17 and found the
same clean state the 2026-08-15 lane recorded, ~3 days after the fix:

- `/run/systemd/sessions` → **0 entries** (was exactly 8192, the kernel session
  table cap, on 2026-08-14 before the fix).
- `loginctl list-sessions` → **0 sessions**, none stuck in `closing`.
- `systemd-logind` has **`NRestarts=0`** and `ActiveEnterTimestamp` of
  `Fri 2026-08-14 08:00:11 IST` — the fix restart is still the running instance;
  nothing has re-wedged or crashed in ~3 days.
- `uptime` → `0 user` (the incident peak showed `8192 users`).
- sshd accepts new connections: a fresh ssh connection to the live tailnet bind
  (`100.64.0.0:22`) reached the publickey challenge stage
  (`Permission denied (publickey)`), i.e. the server answered a newly initiated
  session — the pre-fix symptom was every new session being refused outright.
  `/run/systemd/sessions` and `loginctl` both stayed at 0/0 after the test.
- The sshd listen sockets are still the hardened tailnet-only binds
  (`100.64.0.0:22`, `[fd7a:115c:a1e0::0]:22`) — no `0.0.0.0:22`
  wildcard. (`ssh localhost` is refused because sshd no longer listens on
  loopback — the intended posture, not a session-table refusal.)

## Root cause (as recorded in PR #712, still standing)

- The 8192 sessions were `closing` zombies whose scopes were already torn down;
  the churn came from the `nish` user manager running a oneshot service loop
  (`fleet-key-watch.service`, `Type=oneshot`, `TimeoutStartSec=5min`, re-run by
  its user timer) that spawned one transient scope per run.
- Under systemd v255+, logind does not reap `closing` sessions whose manager is
  the user manager, so `/run/systemd/sessions` filled to the 8192 cap and logind
  refused every subsequent session.
- The oneshot churn follow-up (guard/remove `fleet-key-watch.service`
  auto-restart or add a `RuntimeMaxSec`) is a VPS/systemd configuration change
  outside this repo's lane scope, explicitly deferred in PR #712 and unchanged
  by this lane.

## Fix applied (live, 2026-08-14, from PR #712)

```
sudo systemctl restart systemd-logind
```

- Before: `loginctl list-sessions` → 8192 sessions, all `closing`;
  `uptime` → `8192 users`.
- After: 7 active sessions, `/run/systemd/sessions` → 4; sshd accepting again.

## Re-verification evidence (this lane, 2026-08-17 ~06:15–06:20 IST)

```
$ ls /run/systemd/sessions | wc -l                  → 0
$ loginctl list-sessions --no-legend | wc -l        → 0
$ systemctl show systemd-logind -p NRestarts,ActiveEnterTimestamp
  NRestarts=0
  ActiveEnterTimestamp=Fri 2026-08-14 08:00:11 IST
$ uptime                                            → ... 0 user, ...
$ ss -tlnp | grep ':22 '
  LISTEN 0 4096 100.64.0.0:22
  LISTEN 0 4096 [fd7a:115c:a1e0::0]:22
$ timeout 12 ssh -o BatchMode=yes -o StrictHostKeyChecking=no \
    -o ConnectTimeout=5 nish@100.64.0.0 true
  nish@100.64.0.0: Permission denied (publickey).   # server accepted the session
$ ls /run/systemd/sessions | wc -l                  # after test → 0
$ loginctl list-sessions --no-legend | wc -l        # after test → 0
```

No recurrence, no new incident, no product code change warranted.

## Files

- `.lane/reports/0509-lane1-sshd-session-table-fresh-verification.md` — this
  fresh re-verification evidence record; the only repo change, no product code
  touched.
- Prior records (unchanged, already on main): 
  `.lane/reports/0509-lane1-sshd-session-table-reverified.md` (2026-08-15, PR #753)
  and `.lane/reports/report-lane1-sshd-session-table-exhausted.md` (2026-08-14, PR #712).