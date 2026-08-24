#!/usr/bin/env bash
#
# Production liveness probe for 0509 (https://0509.io).
#
# Runs on the fleet VPS under a systemd timer (0509-liveness.timer) every five
# minutes, completely outside GitHub Actions: Actions' shortest cron interval
# is five minutes but in practice this repo's 5-minute schedule fired about
# once an hour (median 63 minutes between runs over 300 observations,
# 2026-07-25..2026-08-11), so scheduled workflow runs were never a real
# liveness detector.
#
# The probe checks the same public contract the old scheduled workflow did:
#   - https://0509.io/api/health         (shallow: Worker edge is alive)
#   - https://0509.io/api/health/deep    (D1 SELECT 1 + scheduled-work check)
# curl retries (3 attempts) absorb single blips before a sample goes red,
# matching the previous workflow behavior.
#
# Every run appends one JSON record to $LIVENESS_STATE_DIR/probes.jsonl and
# rewrites $LIVENESS_STATE_DIR/latest.json. Records are world-readable so the
# release-soak finalizer (which runs as an unprivileged GitHub runner account
# on this host) can verify exact-worker soak evidence from them. The probe
# exits non-zero on failure: systemd marks the unit failed and journald keeps
# the reason, while latest.json carries a persistent "degraded" marker for
# operators and fleet watchdogs.
#
# No secrets, no GitHub tokens, no Cloudflare credentials.

set -euo pipefail

readonly STATE_DIR="${LIVENESS_STATE_DIR:-/var/lib/0509-liveness}"
readonly HEALTH_URL="${HEALTH_URL:-https://0509.io/api/health}"
readonly DEEP_HEALTH_URL="${DEEP_HEALTH_URL:-https://0509.io/api/health/deep}"
readonly RETENTION_DAYS="${PROBE_RETENTION_DAYS:-30}"

fail() {
  printf '0509-liveness: %s\n' "$*" >&2
  exit 1
}

mkdir -p "${STATE_DIR}"
umask 022

# Single-instance serialization is owned by systemd: this probe runs as
# 0509-liveness.service (Type=oneshot) triggered by 0509-liveness.timer. A
# oneshot unit cannot overlap itself — systemd will not start a unit that is
# already activating, so a timer fire during a still-running probe is a no-op
# and a manual `systemctl start` waits rather than running a second copy. No
# shell-level advisory-lock mutex is needed or permitted (the canonical
# no-hand-built-orchestration gate bans hand-built mutex wrappers; systemd
# owns single-instance semantics for oneshot units).

readonly TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
shallow_status=0
deep_status=0
worker_version=""
search_rollout_mode=""
d1_check=""
scheduled_work_check=""
error=""

# Fetches the shallow payload once and validates it. On success the payload
# stays in SHALLOW_PAYLOAD for the record without a second network request.
probe_shallow() {
  local response
  response="$(curl --fail --show-error --silent --max-time 20 --retry 2 --retry-delay 5 "${HEALTH_URL}" 2>/dev/null)" || {
    error="shallow_http_failed"
    return 1
  }
  SHALLOW_PAYLOAD="${response}"
  export SHALLOW_PAYLOAD
  if ! python3 - <<'PY'
import json
import os
import re

payload = json.loads(os.environ["SHALLOW_PAYLOAD"])
if payload.get("status") != "ok":
    raise SystemExit(f"health status was {payload.get('status')!r}, expected 'ok'")
if payload.get("app") != "0509":
    raise SystemExit(f"health app was {payload.get('app')!r}, expected '0509'")
identity = payload.get("releaseIdentity") or {}
worker_version = identity.get("workerVersionId")
if not isinstance(worker_version, str) or not worker_version or len(worker_version) > 128:
    raise SystemExit("health worker version was missing or unsafe")
if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", worker_version):
    raise SystemExit("health worker version contained unsafe characters")
if identity.get("searchRolloutMode") != "v2":  # prod SEARCH_ROLLOUT_MODE=v2 (main wrangler.jsonc) since 2026-08-12T22:17Z; shadow assertion was stale
    raise SystemExit("health search rollout mode was not v2")
PY
  then
    error="shallow_payload_invalid"
    return 1
  fi
}

probe_deep() {
  local response
  response="$(curl --fail --show-error --silent --max-time 20 --retry 2 --retry-delay 5 "${DEEP_HEALTH_URL}" 2>/dev/null)" || {
    error="deep_http_failed"
    return 1
  }
  DEEP_HEALTH_PAYLOAD="${response}"
  DEEP_EXPECTED_WORKER_VERSION="${worker_version}"
  export DEEP_HEALTH_PAYLOAD DEEP_EXPECTED_WORKER_VERSION
  if ! python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["DEEP_HEALTH_PAYLOAD"])
if payload.get("status") != "ok":
    raise SystemExit(f"deep health status was {payload.get('status')!r}, expected 'ok'")
checks = payload.get("checks") or {}
if checks.get("d1") != "ok":
    raise SystemExit(f"deep health d1 check was {checks.get('d1')!r}, expected 'ok'")
if checks.get("scheduledWork") != "ok":
    raise SystemExit(
        f"deep health scheduled-work check was {checks.get('scheduledWork')!r}, expected 'ok'"
    )
identity = payload.get("releaseIdentity") or {}
if identity.get("workerVersionId") != os.environ["DEEP_EXPECTED_WORKER_VERSION"]:
    raise SystemExit("deep health worker version did not match shallow health")
if identity.get("searchRolloutMode") != "v2":  # prod SEARCH_ROLLOUT_MODE=v2 (main wrangler.jsonc) since 2026-08-12T22:17Z; shadow assertion was stale
    raise SystemExit("deep health search rollout mode was not v2")
PY
  then
    error="deep_payload_invalid"
    return 1
  fi
}

ok=true
if probe_shallow; then
  shallow_status=1
  search_rollout_mode="$(printf '%s' "${SHALLOW_PAYLOAD}" | python3 -c '
import json
import sys
sys.stdout.write((json.load(sys.stdin).get("releaseIdentity") or {}).get("searchRolloutMode") or "")
')" || search_rollout_mode=""
  worker_version="$(printf '%s' "${SHALLOW_PAYLOAD}" | python3 -c '
import json
import sys
sys.stdout.write((json.load(sys.stdin).get("releaseIdentity") or {}).get("workerVersionId") or "")
')" || worker_version=""
  if [[ -z "${worker_version}" ]]; then
    ok=false
    error="${error:-shallow_version_parse_failed}"
  elif probe_deep; then
    d1_check="ok"
    scheduled_work_check="ok"
    deep_status=1
  else
    ok=false
  fi
else
  ok=false
fi

record="$(python3 - "${TS}" "${ok}" "${shallow_status}" "${deep_status}" "${worker_version}" "${search_rollout_mode}" "${d1_check}" "${scheduled_work_check}" "${error}" <<'PY'
import json
import sys

ts, ok, shallow_status, deep_status, worker_version, rollout, d1, scheduled, error = sys.argv[1:]
print(json.dumps({
    "ts": ts,
    "ok": ok == "true",
    "shallowStatus": int(shallow_status),
    "deepStatus": int(deep_status),
    "workerVersionId": worker_version or None,
    "searchRolloutMode": rollout or None,
    "d1": d1 or None,
    "scheduledWork": scheduled or None,
    "error": error or None,
}, sort_keys=True, separators=(",", ":")))
PY
)"

printf '%s\n' "${record}" >>"${STATE_DIR}/probes.jsonl"

latest="$(python3 - "${TS}" "${ok}" "${worker_version}" "${error}" <<'PY'
import json
import sys

ts, ok, worker_version, error = sys.argv[1:]
print(json.dumps({
    "status": "ok" if ok == "true" else "degraded",
    "ts": ts,
    "workerVersionId": worker_version or None,
    "error": error or None,
}, sort_keys=True, separators=(",", ":")))
PY
)"
printf '%s\n' "${latest}" >"${STATE_DIR}/latest.json"

# Prune evidence older than the retention window. Rewrite in place so the
# file stays a single JSONL stream; the collector never reads a partial line
# because we only ever rewrite from complete records.
python3 - "${STATE_DIR}/probes.jsonl" "${RETENTION_DAYS}" <<'PY'
import json
import os
import sys
import tempfile
import time

path = sys.argv[1]
retention_seconds = int(sys.argv[2]) * 86400
cutoff = time.time() - retention_seconds
try:
    with open(path, "r", encoding="utf-8") as source:
        records = [line for line in source if line.strip()]
except FileNotFoundError:
    sys.exit(0)
keep = []
for line in records:
    try:
        parsed = json.loads(line)
        ts = parsed.get("ts")
        if isinstance(ts, str) and len(ts) >= 19:
            kept = time.mktime(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
        else:
            kept = 0
    except (ValueError, TypeError):
        kept = 0
    if kept >= cutoff:
        keep.append(line)
if len(keep) != len(records):
    fd, temporary = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".probes-prune-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as out:
            out.writelines(keep)
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
PY

printf '%s\n' "${record}"
if [[ "${ok}" == "true" ]]; then
  exit 0
fi
fail "production health probe failed: ${error:-unknown}"
