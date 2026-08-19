#!/usr/bin/env bash
# Run the vitest suite with a single, signature-gated retry. It is wired as
# the repo's `test` npm script (package.json), so every consumer that runs
# `npm run test` — the `codex-node-checks` CI step, the deploy-production
# verification step, `launch:readiness` — gets the retry without touching any
# workflow file.
#
# Vitest 4.1.x keeps its forks-pool worker startup budget hardcoded: 90s for
# the worker to report ready and 60s for its start handshake (raised from 5s/
# 10s in upstream fix vitest-dev/vitest#9027, but still not configurable).
# On the shared self-hosted vps-verify runner a load spike from concurrent
# lanes can push a fork worker past that budget and, because a fresh fork
# worker can be spawned per test file, the whole Test step dies on one
# unlucky start. `vite.config.ts` keeps per-file isolation enabled (vitest
# default) so `vi.mock` module interception stays reliable; this wrapper is
# the deflake mechanism. These failures are transient and are not a verdict
# on the code under test.
#
# This wrapper retries ONCE, and only when the failure is that exact pool
# startup timeout. Any other failure (assertion errors, build errors, worker
# crashes) exits with the original status immediately, so the retry cannot
# mask a real regression. When invoked through the deploy-window lane, the
# retry happens inside the lane already acquired, so it never re-enters the
# verification queue.
#
# Usage:
#   ci-vitest-run.sh [--] [command...]
#
# With no arguments the suite command defaults to the raw vitest run command
# that `npm test` used to be (`vitest run --configLoader runner`), so the
# wrapper can safely be the `test` script without recursing. Tests inject
# fake commands plus CI_VITEST_LOG to exercise the retry decision without
# running the suite.
set -u

LOG_FILE="${CI_VITEST_LOG:-${TMPDIR:-/tmp}/ci-vitest-run-$$.log}"
MAX_ATTEMPTS=2
: >"$LOG_FILE"
trap 'rm -f -- "$LOG_FILE"' EXIT

# The exact error strings vitest 4.1.x prints when a forks worker fails to
# start inside its hardcoded budget:
#   [vitest-pool]: Timeout starting forks runner.                (90s watchdog)
#   [vitest-pool-runner]: Timeout waiting for worker to respond (60s handshake)
#   [vitest-pool]: Failed to start forks worker ...              (wrapper of the above)
is_worker_startup_timeout() {
  grep -Eq -- '\[vitest-pool(-runner)?\]: (Timeout starting forks runner|Timeout waiting for worker to respond|Failed to start forks worker)' "$LOG_FILE"
}

run_attempt() {
  "$@" 2>&1 | tee -a -- "$LOG_FILE"
  return "${PIPESTATUS[0]}"
}

main() {
  local command=(vitest run --configLoader runner) attempt=1 rc=0

  if [ "$#" -gt 0 ]; then
    if [ "$1" = "--" ]; then
      shift
    fi
    if [ "$#" -gt 0 ]; then
      command=("$@")
    fi
  fi

  printf 'ci-vitest-run: attempt %s/%s: %s\n' "$attempt" "$MAX_ATTEMPTS" "${command[*]}" >&2
  run_attempt "${command[@]}"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    exit 0
  fi

  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    printf 'ci-vitest-run: suite failed with exit %s\n' "$rc" >&2
    exit "$rc"
  fi

  if ! is_worker_startup_timeout; then
    printf 'ci-vitest-run: suite failed with exit %s (not a worker startup timeout; not retrying)\n' "$rc" >&2
    exit "$rc"
  fi

  printf 'ci-vitest-run: attempt %s/%s hit the vitest forks-worker startup timeout; retrying once\n' "$attempt" "$MAX_ATTEMPTS" >&2
  attempt=$((attempt + 1))
  printf 'ci-vitest-run: attempt %s/%s: %s\n' "$attempt" "$MAX_ATTEMPTS" "${command[*]}" >&2
  run_attempt "${command[@]}"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    printf 'ci-vitest-run: retry passed\n' >&2
    exit 0
  fi

  printf 'ci-vitest-run: retry failed with exit %s\n' "$rc" >&2
  exit "$rc"
}

main "$@"
