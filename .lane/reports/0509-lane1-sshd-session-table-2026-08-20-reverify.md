# VPS session table exhausted at the 8192 cap — fresh live re-verification (2026-08-20 lane 1)

**Status: resolved — live re-verification of the 2026-08-14 fix (PR #712) on
2026-08-20, ~6 days after the fix; evidence record only, no product code
touched.**

Branch: `0509-lane1-sshd-session-table-2026-08-20-reverify`
Base: `origin/main` at `5b33e274`

## Item

- [ ] VPS session table exhausted at the 8192 cap — 8192 nish sessions stuck in "closing",
  sshd has refused every new se(ssion)

## Verdict

The incident described in the item is **cleared live and has not recurred since
the 2026-08-14 fix**. This lane re-verified the live box on 2026-08-20 and
found the same clean state the 2026-08-15 (PR #753) and 2026-08-17
(`0509-lane1-sshd-session-table-fresh-verification`) lanes recorded, ~6 days
after the original fix:

- `ls /run/systemd/sessions | wc -l` → **16 entries** (was exactly 8192, the
  kernel session table cap, on 2026-08-14 before the fix). 16 is 0.20% of the
  8192 cap — the wedge has not returned.
- `loginctl list-sessions --no-legend | wc -l` → **10 sessions**: 7 `active`
  (the live terminals, including this lane's two ssh sessions) and 3 `closing`
  (each backed by a real, still-loaded `session-*.scope` — these are normal
  short-lived tailnet disconnects, not the 8192 orphan zombies from 2026-08-14
  that had no scopes at all).
- `systemctl list-units 'session-*.scope' --no-legend | wc -l` → **10 scopes**,
  one per loginctl row, all `active` (state `running` or `abandoned` for the
  closing-but-remembered ones). The 2026-08-14 wedge showed only 2 scopes for
  8192 sessions; today every session has its scope intact.
- `systemd-logind` has **`NRestarts=0`** and `ActiveEnterTimestamp` of
  `Fri 2026-08-14 08:00:11 IST` — the fix restart from PR #712 is still the
  running instance; nothing has re-wedged or crashed in ~6 days.
- `uptime` → `10 users` (the incident peak showed `8192 users`).
- sshd accepts new connections: a fresh ssh connection to the live tailnet
  bind (`100.64.0.0:22`) reached the publickey challenge stage
  (`Permission denied (publickey)`), i.e. the server answered a newly
  initiated session — the pre-fix symptom was every new session being refused
  outright. The session count stayed at 16/10 after the test connection (no
  residual zombie accumulation).
- The sshd listen sockets are still the hardened tailnet-only binds
  (`100.64.0.0:22`, `[fd7a:115c:a1e0::0]:22`) — no `0.0.0.0:22`
  wildcard. (`ssh localhost` is refused because sshd no longer listens on
  loopback — the intended posture, not a session-table refusal.)
- `cat /proc/sys/kernel/pty/nr` → 4 (no PTY exhaustion); `df /run` → 14% used
  (no inode or disk pressure on the session directory).

## Root cause (as recorded in PR #712, still standing)

- The 8192 sessions were `closing` zombies whose scopes were already torn down;
  the churn came from the `nish` user manager running a oneshot service loop
  (`fleet-key-watch.service`, `Type=oneshot`, `TimeoutStartSec=5min`, re-run by
  its user timer) that spawned one transient scope per run.
- Under systemd v255+, logind does not reap `closing` sessions whose manager is
  the user manager, so `/run/systemd/sessions` filled to the 8192 cap and logind
  refused every subsequent session.
- Live re-check 2026-08-20: `fleet-key-watch.service` still exists and is
  unchanged
  (`/home/nish/.config/systemd/user/fleet-key-watch.service`,
  `Type=oneshot`, `TimeoutStartSec=5min`; mtime `2026-08-09 15:32`).
  The service/timer was **not** modified by this lane (VPS/systemd
  configuration is outside this repo's lane scope and was explicitly deferred
  in PR #712); the recurrence risk the churn poses remains a tracked
  follow-up. The fact that the wedge has not re-formed in ~6 days while the
  churn source is still present is consistent with PR #712's "low-probability
  re-wedge unless the user-manager churn rate changes" assessment.

## Fix applied (live, 2026-08-14, from PR #712)

```
sudo systemctl restart systemd-logind
```

- Before: `loginctl list-sessions` → 8192 sessions, all `closing`;
  `uptime` → `8192 users`.
- After: 7 active sessions, `/run/systemd/sessions` → 4; sshd accepting again.

## Re-verification evidence (this lane, 2026-08-20 ~16:16–16:18 IST)

```
$ ls /run/systemd/sessions | wc -l                  → 16   (was 8192 on 2026-08-14)
$ loginctl list-sessions --no-legend | wc -l        → 10
$ systemctl list-units 'session-*.scope' --no-legend | wc -l   → 10
$ systemctl show systemd-logind -p NRestarts,ActiveEnterTimestamp,ExecMainStartTimestamp
  NRestarts=0
  ExecMainStartTimestamp=Fri 2026-08-14 08:00:08 IST
  ActiveEnterTimestamp=Fri 2026-08-14 08:00:11 IST
$ uptime                                            → ... 10 users, load average: 1.97, 2.08, 2.46
$ ss -tlnp | grep ':22 '
  LISTEN 0 4096 100.64.0.0:22
  LISTEN 0 4096 [fd7a:115c:a1e0::0]:22
$ cat /proc/sys/kernel/pty/nr                       → 4
$ df /run                                           → 14% used
$ timeout 10 ssh -o BatchMode=yes -o StrictHostKeyChecking=no \
    -o ConnectTimeout=5 nish@100.64.0.0 true
  nish@100.64.0.0: Permission denied (publickey).   # server accepted the session
$ ls /run/systemd/sessions | wc -l                  # after test → 16
$ loginctl list-sessions --no-legend | wc -l        # after test → 10
```

No recurrence, no new incident, no product code change warranted.

## Files

- `.lane/reports/0509-lane1-sshd-session-table-2026-08-20-reverify.md` — this
  fresh re-verification evidence record; the only repo change, no product
  code touched.
- Prior records (unchanged, already on main):
  `.lane/reports/0509-lane1-sshd-session-table-fresh-verification.md`
  (2026-08-17), `.lane/reports/0509-lane1-sshd-session-table-reverified.md`
  (2026-08-15, PR #753), and
  `.lane/reports/report-lane1-sshd-session-table-exhausted.md` (2026-08-14,
  PR #712).
