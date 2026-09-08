#!/usr/bin/env bash
# Check the market-signal D1 snapshot age and exit non-zero if it is stale.
#
# The daily snapshot is published by .github/workflows/market-signal-snapshot.yml
# to the PRIVATE sink repo Nishfleet/0509-telemetry on the data branch
# `automation/market-signal-snapshot` at path
# `ops/market-signal/0509-market-signal.json`. This script fetches that file,
# reads its `generatedAt` ISO-8601 timestamp, and exits:
#   0  if the snapshot age is under the threshold (default 24h) -- fresh
#   1  if the snapshot is missing, unparseable, or older than the threshold
#
# It is the termination condition for issue #1894 ("scripts/check-d1-snapshot-age.sh
# exits 0 (age < 24h)") and the detector behind the
# market-signal-snapshot-age.yml monitor, which files a `market-signal-stale`
# issue when this script exits non-zero.
#
# Fetch modes:
#   - TELEMETRY_DEPLOY_KEY set (CI): fetch over SSH with that deploy key (the
#     same write-enabled key the publish step uses; read is lower privilege).
#   - otherwise (host with `gh auth` / cached creds): fetch over https.
#
# Test mode: `--snapshot-file <path>` reads a local snapshot file instead of
# fetching, so the age logic can be exercised without network or credentials.
#
# Usage:
#   scripts/check-d1-snapshot-age.sh [--max-age-hours N] [--snapshot-file PATH]
set -euo pipefail

TELEMETRY_REPO="Nishfleet/0509-telemetry"
SNAPSHOT_BRANCH="automation/market-signal-snapshot"
SNAPSHOT_PATH="ops/market-signal/0509-market-signal.json"
MAX_AGE_HOURS=24
SNAPSHOT_FILE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --max-age-hours)
      MAX_AGE_HOURS="$2"
      shift 2
      ;;
    --snapshot-file)
      SNAPSHOT_FILE="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *)
      echo "check-d1-snapshot-age: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

# One EXIT trap cleans every temp path this script may create (WORK_DIR for the
# fetch branch, SNAPSHOT_TMP for the parsed payload), in any exit order.
WORK_DIR=""
SNAPSHOT_TMP=""
trap 'rm -f "$SNAPSHOT_TMP"; [ -n "$WORK_DIR" ] && rm -rf "$WORK_DIR"' EXIT

# Resolve the snapshot JSON content into $SNAPSHOT_JSON.
if [ -n "$SNAPSHOT_FILE" ]; then
  if [ ! -f "$SNAPSHOT_FILE" ]; then
    echo "market_signal_snapshot_missing: --snapshot-file not found: $SNAPSHOT_FILE" >&2
    exit 1
  fi
  SNAPSHOT_JSON="$(cat "$SNAPSHOT_FILE")"
else
  WORK_DIR="$(mktemp -d)"
  cd "$WORK_DIR"
  git init -q
  if [ -n "${TELEMETRY_DEPLOY_KEY:-}" ]; then
    KEY_FILE="$WORK_DIR/telemetry_deploy_key"
    printf '%s\n' "$TELEMETRY_DEPLOY_KEY" > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
    export GIT_SSH_COMMAND="ssh -i \"$KEY_FILE\" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=\"$WORK_DIR/known_hosts\""
    FETCH_URL="git@github.com:${TELEMETRY_REPO}.git"
  else
    FETCH_URL="https://github.com/${TELEMETRY_REPO}.git"
  fi
  if ! git fetch --quiet --depth 1 "$FETCH_URL" "$SNAPSHOT_BRANCH" 2>/dev/null; then
    echo "market_signal_snapshot_fetch_failed: could not fetch $SNAPSHOT_BRANCH from $TELEMETRY_REPO" >&2
    exit 1
  fi
  if ! SNAPSHOT_JSON="$(git show "FETCH_HEAD:$SNAPSHOT_PATH" 2>/dev/null)"; then
    echo "market_signal_snapshot_missing: $SNAPSHOT_PATH not on $SNAPSHOT_BRANCH in $TELEMETRY_REPO" >&2
    exit 1
  fi
fi

# Parse generatedAt and compute age in hours; emit verdict. python3 is available
# on ubuntu-latest runners and on the host. The verdict line is machine-greppable.
# The snapshot JSON is handed to python3 via a temp file (not stdin) because the
# heredoc already uses stdin for the script body.
SNAPSHOT_TMP="$(mktemp)"
printf '%s' "$SNAPSHOT_JSON" > "$SNAPSHOT_TMP"
MAX_AGE_HOURS="$MAX_AGE_HOURS" SNAPSHOT_PATH="$SNAPSHOT_TMP" python3 - <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

max_age_hours = float(os.environ["MAX_AGE_HOURS"])
with open(os.environ["SNAPSHOT_PATH"], "r", encoding="utf-8") as fh:
    raw = fh.read()
try:
    payload = json.loads(raw)
except Exception:
    sys.stderr.write("market_signal_snapshot_invalid: snapshot is not valid JSON\n")
    sys.exit(1)

generated_at = payload.get("generatedAt") if isinstance(payload, dict) else None
if not generated_at:
    sys.stderr.write("market_signal_snapshot_invalid: generatedAt missing\n")
    sys.exit(1)

try:
    parsed = datetime.fromisoformat(str(generated_at).replace("Z", "+00:00"))
except Exception:
    sys.stderr.write(f"market_signal_snapshot_invalid: generatedAt unparseable: {generated_at}\n")
    sys.exit(1)

if parsed.tzinfo is None:
    parsed = parsed.replace(tzinfo=timezone.utc)

age_seconds = (datetime.now(timezone.utc) - parsed).total_seconds()
age_hours = age_seconds / 3600.0

if age_hours < 0:
    sys.stderr.write(f"market_signal_snapshot_invalid: generatedAt is in the future: {generated_at}\n")
    sys.exit(1)

if age_hours > max_age_hours:
    sys.stderr.write(
        f"market_signal_snapshot_stale: generatedAt={generated_at} age={age_hours:.2f}h "
        f"threshold={max_age_hours:g}h\n"
    )
    sys.exit(1)

print(f"market_signal_snapshot_fresh generatedAt={generated_at} age={age_hours:.2f}h threshold={max_age_hours:g}h")
PY
