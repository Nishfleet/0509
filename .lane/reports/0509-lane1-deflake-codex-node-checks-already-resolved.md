# Lane 1 report — codex-node-checks vitest forks-worker startup timeout, already resolved by PR #626

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-deflake-codex-node-checks-already-resolved`
Base: `origin/main` at `422fbd55` (current tip)

## Item

- [ ] De-flake codex-node-checks on the vps-verify runner: vitest forks-worker
  startup timeout intermittently kills the Test step.

## Verdict

No code change is warranted. The deflake is already shipped on `origin/main`
as PR #626 — commit `aedaf6b1` "ci: retry codex-node-checks vitest step once
on forks-worker startup timeout", merged 2026-08-20, and `aedaf6b1` is an
ancestor of the current `main` HEAD (`422fbd55`). `scripts/ci-vitest-run.sh`
is the signature-gated retry wrapper the Test step already invokes through
`npm run test` (the `test` script is `bash ./scripts/ci-vitest-run.sh`), so
every consumer of `npm run test` — `codex-node-checks` (the
`[self-hosted, linux, x64, vps-verify]` job in `.github/workflows/ci.yml`),
the `deploy-production` verification step, and `launch:readiness` — gets the
deflake without touching any workflow file. This lane re-verified the
deflake on the current tip and re-ran the regression tests.

## How the deflake works

`scripts/ci-vitest-run.sh` (currently on `origin/main`):

- Wraps the suite command, defaulting to `vitest run --configLoader runner`
  (the same raw command `npm test` used to be).
- Caps `MAX_ATTEMPTS=2` and pipes both runs into a per-invocation log file
  via `tee`.
- After the first attempt fails, it greps the captured log for any of the
  three exact signatures vitest 4.1.x prints when a forks worker fails to
  start inside its hardcoded budget (90 s ready / 60 s handshake — raised
  from 5 s / 10 s in vitest-dev/vitest#9027 but still not configurable):
  - `[vitest-pool]: Timeout starting forks runner.`
  - `[vitest-pool-runner]: Timeout waiting for worker to respond`
  - `[vitest-pool]: Failed to start forks worker ...`
- Retries exactly once only when one of those three signatures is present.
  Any other failure (assertion error, build error, worker runtime crash)
  exits with the original non-zero status and never retries, so the retry
  cannot mask a real regression.
- Runs the retry inside the deploy-window lane the step already acquired
  (the `codex-node-checks` Test step is wrapped in
  `./scripts/deploy-window-lock.sh run -- npm run test`), so it never
  re-enters the verification queue.

## Evidence on current main

### PR #626 is on `origin/main`

```
$ git rev-parse --verify aedaf6b1
aedaf6b188153331583963159edc6180b44a6ec7

$ git log --oneline origin/main -- scripts/ci-vitest-run.sh tests/ci-vitest-run.test.ts
aedaf6b1 ci: retry codex-node-checks vitest step once on forks-worker startup timeout (#626)
```

### Wrapper is wired into the Test step

`.github/workflows/ci.yml` `codex-node-checks` (the
`[self-hosted, linux, x64, vps-verify]` job, `timeout-minutes: 270`):

```
- name: Test
  run: ./scripts/deploy-window-lock.sh run -- npm run test
```

`package.json` `scripts.test`:

```
"test": "bash ./scripts/ci-vitest-run.sh"
```

So `npm run test` is the wrapper, and the wrapper defaults to the raw
`vitest run --configLoader runner` command (locked by the
"defaults the suite command to the raw vitest run command" regression).

### Regression suite on current main

```
$ ./node_modules/.bin/vitest run tests/ci-vitest-run.test.ts

 RUN  v4.1.10 /home/nish/workspaces/agent-worktrees/0509-lane1-20260821-021043

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  370ms (transform 44ms, setup 0ms, import 61ms, tests 117ms, environment 0ms)
```

The nine cases pin both halves of the boundary:

- retry once when the first attempt dies on `Timeout starting forks runner.`
- retry once on the 60 s handshake surface `Failed to start forks worker ...`
- retry once on the `vitest-pool-runner` handshake signature
- retry at most once and propagate the retry exit code
- do not retry on an assertion failure (exit code preserved)
- do not retry on a worker runtime crash (`[vitest-pool]: Worker forks
  emitted error ...`)
- preserve the original exit code when the first attempt passes
- default the suite command to the raw vitest run command
- accept an explicit `--` separator before the command

### End-to-end smoke test (this lane)

A. Timeout signature, expect retry then pass:

```
$ > /tmp/.../invocations
$ bash scripts/ci-vitest-run.sh -- sh /tmp/.../fake-suite.sh /tmp/.../invocations
ci-vitest-run: attempt 1/2: sh /tmp/.../fake-suite.sh /tmp/.../invocations
Error: [vitest-pool]: Timeout starting forks runner.
ci-vitest-run: attempt 1/2 hit the vitest forks-worker startup timeout; retrying once
ci-vitest-run: attempt 2/2: sh /tmp/.../fake-suite.sh /tmp/.../invocations
fake-suite retry ok
ci-vitest-run: retry passed
$ cat /tmp/.../invocations
2
```

B. Assertion failure, expect no retry, exit 1 preserved:

```
$ > /tmp/.../invocations
$ bash scripts/ci-vitest-run.sh -- sh /tmp/.../assert-suite.sh /tmp/.../invocations
ci-vitest-run: attempt 1/2: sh /tmp/.../assert-suite.sh /tmp/.../invocations
AssertionError: expected 1 to deeply equal 2
ci-vitest-run: suite failed with exit 1 (not a worker startup timeout; not retrying)
$ echo $? ; cat /tmp/.../invocations
1
1
```

Both match the spec exactly: the retry fires only on the three forks-worker
startup-timeout signatures, and any other failure exits immediately with the
original status.

## Files

- `.lane/reports/0509-lane1-deflake-codex-node-checks-already-resolved.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, billing, or CI
behaviour change.
