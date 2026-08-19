# Fleet Backlog Console refresh (systemd --user)

Source of truth for the deterministic zero-token Fleet Backlog Console refresh
installed on the VPS:

- `refresh.sh` — assembles the console from fleet2 var state / git / systemd via
  `generate.py`, deploys to nish.sh via `push.sh`, then runs a freshness
  self-check that re-runs once and only pages Nish after a repeated failure.
- `backlog-console-refresh.service` — oneshot unit that runs `refresh.sh`.
- `backlog-console-refresh.timer` — hourly timer (`OnCalendar=*-*-* *:24:00`).
- `test_refresh.sh` — hermetic regression test (see below).

## Install

```sh
install -m 0755 refresh.sh /home/nish/.local/bin/backlog-console-refresh.sh
install -m 0644 backlog-console-refresh.service /home/nish/.config/systemd/user/
install -m 0644 backlog-console-refresh.timer /home/nish/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now backlog-console-refresh.timer
```

## Root cause fixed 2026-08-19

The unit exited 1 on every timer firing while the same script exited 0 by hand.
The difference was **credentials, not PATH/cwd**: systemd --user runs with a
minimal environment that does not carry the interactive shell's
`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, so `push.sh`'s wrangler call
failed with *"assign its value to CLOUDFLARE_API_TOKEN"* and the console went
stale. `refresh.sh` now sources `fleet-console/cf.env` (mirroring
`inish-publish-now`) when the token is not already set, so it authenticates
under systemd too.

The unit was also **masked** (symlinked to `/dev/null`) to stop the paging;
unmasking + re-enabling the timer is part of the fix.

## Fail LOUD

`refresh.sh` logs its failure reason to the journal via `logger -t
backlog-console-refresh` **and** to stderr (which systemd captures) on the
repeated-failure path — never a silent `exit 1`. `CONSOLE_LOGGER` overrides the
logger binary for hermetic testing.

## Test

```sh
bash test_refresh.sh
```

Runs against a throwaway directory and asserts: (1) the script sources `cf.env`
so the push sees the Cloudflare credentials, and (2) on repeated failure the
reason reaches both the journal and stderr with exit 1.
