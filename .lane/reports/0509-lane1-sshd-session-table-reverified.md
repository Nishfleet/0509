# VPS session table exhausted at the 8192 cap — fresh live re-verification (2026-08-15 lane 1)

**Status: resolved — live re-verification of the 2026-08-14 fix (PR #712), evidence record only, no product code touched.**

Branch: `0509-lane1-sshd-session-table-reverified`
Base: `origin/main` at `061fa462`

## Item

- [ ] VPS session table exhausted at the 8192 cap — 8192 nish sessions stuck in "closing",
  sshd has refused every new se(ssion)

## Verdict

The incident described in the item is **cleared live and has not recurred**. The
2026-08-14 lane (PR #712, `.lane/reports/report-lane1-sshd-session-table-exhausted.md`)
diagnosed it and cleared it with a `systemctl restart systemd-logind`; this lane
re-verified the live box on 2026-08-15 and found:

- `/run/systemd/sessions` → **0 entries** (was exactly 8192, the kernel session
  table cap, on 2026-08-14 before the restart).
- `loginctl list-sessions` → **0 sessions**, none stuck in `closing`.
- `systemd-logind` has **`NRestarts=0`** since its `ExecMainStartTimestamp` /
  `ActiveEnterTimestamp` of `Fri 2026-08-14 08:00:08/11 IST` — the restart from
  the fix is the only restart; the wedge has not returned in ~24h.
- sshd accepts new connections: a fresh ssh connection to the live tailnet bind
  (`100.64.0.0:22`) reached the publickey challenge stage
  (`Permission denied (publickey)`), which is the server responding to a new
  session — the pre-fix symptom was every new session being refused outright.
  The session count stayed at 0/0 after the test connection.
- The sshd listen sockets are the hardened tailnet-only binds
  (`100.64.0.0:22`, `[fd7a:115c:a1e0::0]:22`) — no `0.0.0.0:22`
  wildcard. (`ssh localhost` is refused because sshd no longer listens on
  loopback, which is the intended pass-5 posture, not a session-table refusal.)

## Root cause (as recorded in PR #712, still standing)

- The 8192 sessions were `closing` zombies whose scopes were already torn down;
  the churn came from the `nish` user manager running a oneshot service loop
  (`fleet-key-watch.service`, `Type=oneshot`, `TimeoutStartSec=5min`, re-run
  continuously by its user timer) that spawned one transient scope per run.
- Under systemd v255+, logind does not reap `closing` sessions whose manager is
  the user manager, so `/run/systemd/sessions` filled to the 8192 cap and logind
  refused every subsequent session.
- Live re-check 2026-08-15: `fleet-key-watch.service` still exists
  (`/home/nish/.config/systemd/user/fleet-key-watch.service`, oneshot + 15-min
  timer). The service/timer was **not** modified by this lane (VPS/systemd
  configuration is outside this repo's lane scope and was explicitly deferred in
  PR #712); the recurrence risk the churn poses remains a tracked follow-up.

## Fix applied (live, 2026-08-14, from PR #712)

```
sudo systemctl restart systemd-logind
```

- Before: `loginctl list-sessions` → 8192 sessions, all `closing`;
  `uptime` → `8192 users`.
- After: 7 active sessions, `/run/systemd/sessions` → 4; sshd accepting again.

## Re-verification evidence (this lane, 2026-08-15 ~08:39–08:43 IST)

```
$ ls /run/systemd/sessions | wc -l          → 0
$ loginctl list-sessions --no-legend | wc -l → 0
$ systemctl show systemd-logind -p NRestarts,ExecMainStartTimestamp,ActiveEnterTimestamp
  NRestarts=0
  ExecMainStartTimestamp=Fri 2026-08-14 08:00:08 IST
  ActiveEnterTimestamp=Fri 2026-08-14 08:00:11 IST
$ ss -tlnp | grep ':22 '
  LISTEN 0 4096 100.64.0.0:22
  LISTEN 0 4096 [fd7a:115c:a1e0::0]:22
$ timeout 10 ssh -o BatchMode=yes -o StrictHostKeyChecking=no \
    -o ConnectTimeout=5 nish@100.64.0.0 true
  nish@100.64.0.0: Permission denied (publickey).   # server accepted the session
$ ls /run/systemd/sessions | wc -l                      # after test → 0
```

No recurrence, no new incident, no product code change warranted.

## Files

- `.lane/reports/0509-lane1-sshd-session-table-reverified.md` — this fresh
  re-verification evidence record; no product code touched.
- Prior record (unchanged): `.lane/reports/report-lane1-sshd-session-table-exhausted.md`
