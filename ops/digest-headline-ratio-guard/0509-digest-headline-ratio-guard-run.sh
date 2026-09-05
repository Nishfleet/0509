#!/usr/bin/env bash
#
# Scheduled runner for the BET 1 digest headline-ratio regression guard
# (issue #1451, accept criteria 3-4).
#
# Runs on the fleet VPS under a systemd timer
# (0509-digest-headline-ratio-guard.timer) outside GitHub Actions, following
# the 0509-demo-brand-timeline-guard pattern: a GitHub scheduled workflow
# would be a gate-owned path edit, which the issue's acceptance criteria
# forbid.
#
# The guard keeps its OWN checkout of Nishfleet/0509 under the state dir and
# fast-forwards it to origin/main every run. The shared
# /home/nish/workspaces/products/0509 checkout is deliberately NOT used: it
# carries other agents' uncommitted work and is not auto-synced, so a guard
# that reads scripts from it could silently run weeks-stale code (or a canary
# that does not exist there yet). This checkout is guard-owned, so
# `git reset --hard` is safe there.
#
# Each run samples the last 24h of delivered digest items from production D1,
# appends the day's headline-ratio measurement under
# $DIGEST_HEADLINE_STATE_DIR (default
# ~/.local/state/0509-digest-headline-ratio/), rewrites the daily summary CSV,
# and evaluates the 7-day rolling signal. On a fired guard (rolling ratio
# below the 50% floor) the canary exits 1 AND auto-files a deduplicated GitHub
# issue pinging #972 (accept criterion 4), using the ambient `gh` auth. The
# non-zero exit also marks the systemd unit failed so journald + a watchdog
# always sees the regression even if issue filing cannot authenticate.

set -euo pipefail

readonly STATE_DIR="${DIGEST_HEADLINE_STATE_DIR:-${HOME}/.local/state/0509-digest-headline-ratio}"
readonly REPO_URL="https://github.com/Nishfleet/0509.git"
readonly MIRROR="/home/nish/workspaces/.mirrors/0509.git"
readonly CF_TOKEN_FILE="${DIGEST_HEADLINE_GUARD_TOKEN_FILE:-/home/nish/.config/cloudflare/deploy-ci.env}"

fail() {
  printf 'digest-headline-ratio-guard: %s\n' "$*" >&2
  exit 2
}

[[ -f "${CF_TOKEN_FILE}" ]] || fail "sanctioned CF token file missing: ${CF_TOKEN_FILE}"

mkdir -p "${STATE_DIR}"

# --- Resolve the checkout ---------------------------------------------------
# An explicit DIGEST_HEADLINE_GUARD_CHECKOUT override is used as-is (testing /
# staging): the guard NEVER fetches or resets a caller-owned tree — a
# `reset --hard` there could destroy someone else's work.
if [[ -n "${DIGEST_HEADLINE_GUARD_CHECKOUT:-}" ]]; then
  CHECKOUT="${DIGEST_HEADLINE_GUARD_CHECKOUT}"
else
  CHECKOUT="${STATE_DIR}/checkout"
  if [[ ! -d "${CHECKOUT}/.git" ]]; then
    if [[ -d "${MIRROR}" ]]; then
      git clone --reference-if-able "${MIRROR}" "${REPO_URL}" "${CHECKOUT}" \
        || fail "could not clone ${REPO_URL}"
    else
      git clone "${REPO_URL}" "${CHECKOUT}" || fail "could not clone ${REPO_URL}"
    fi
  fi
  # This checkout is guard-owned, so hard-syncing to origin/main is safe.
  git -C "${CHECKOUT}" fetch origin main || fail "git fetch origin main failed"
  git -C "${CHECKOUT}" reset --hard -q origin/main \
    || fail "could not reset guard checkout to origin/main"
fi
readonly CHECKOUT

# Fail cheap before any install: if the canary is not on the synced ref yet
# (the PR has not merged), a timer fire costs only a fetch, not an npm ci.
CANARY="${CHECKOUT}/scripts/canary-digest-headline-ratio.mjs"
[[ -f "${CANARY}" ]] || fail "canary not found at ${CANARY} (has the PR landed on main?)"

# Dependencies: the canary needs the repo's pinned wrangler for
# `wrangler d1 execute --remote`. Reinstall only when the lockfile changes so
# daily runs stay cheap; the marker records the hash that was installed.
LOCK_SHA="$(sha256sum "${CHECKOUT}/package-lock.json" | cut -d' ' -f1)"
LOCK_MARKER="${STATE_DIR}/installed-lock.sha256"
if [[ ! -d "${CHECKOUT}/node_modules" ]] \
  || [[ "$(cat "${LOCK_MARKER}" 2>/dev/null)" != "${LOCK_SHA}" ]]; then
  (cd "${CHECKOUT}" && npm ci --ignore-scripts) || fail "npm ci failed"
  printf '%s' "${LOCK_SHA}" > "${LOCK_MARKER}"
fi

# Source the sanctioned Cloudflare token so `wrangler d1 execute --remote` can
# authenticate. The token value is never printed.
# shellcheck source=/dev/null
set -a
. "${CF_TOKEN_FILE}"
set +a

cd "${CHECKOUT}"
export DIGEST_HEADLINE_STATE_DIR="${STATE_DIR}"
exec node scripts/canary-digest-headline-ratio.mjs --file-issue
