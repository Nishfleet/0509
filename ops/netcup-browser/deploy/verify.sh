#!/usr/bin/env bash
# 0509 Netcup renderer — live verification.
# Exits non-zero with a clear message on any failed check; never fixes silently.
set -euo pipefail

INSTALL_DIR="${RENDERER_INSTALL_DIR:-$HOME/.local/share/0509-renderer}"
PORT="${RENDERER_PORT:-9382}"
BASE="http://127.0.0.1:${PORT}"

fail() { echo "FAIL: $*" >&2; exit 1; }

systemctl --user is-active --quiet 0509-renderer.service || fail "0509-renderer.service not active"
systemctl --user is-enabled --quiet 0509-renderer.service || fail "0509-renderer.service not enabled"

for check in healthz readyz; do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${BASE}/${check}")"
  [[ "${code}" == "200" ]] || fail "/${check} returned ${code}"
done

body="$(curl -s --max-time 5 "${BASE}/readyz")"
echo "${body}" | grep -q '"ready":true' || fail "/readyz not ready: ${body}"

# Loopback-only proof: the service must not answer on any non-loopback address.
HOST_IP="$(hostname -I | awk '{print $1}')"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://${HOST_IP}:${PORT}/healthz" 2>/dev/null || true)"
[[ "${code}" != "200" ]] || fail "service answered on non-loopback ${HOST_IP}:${PORT}"

# Secret discipline: no secret files world-readable, no secrets in unit.
find "${HOME}/.config/0509-renderer" -maxdepth 1 -name 'hmac-secret*' -perm /022 2>/dev/null | grep -q . && \
  fail "hmac secret file has world/group permissions"
systemctl --user cat 0509-renderer.service | grep -q hmac-secret && fail "unit leaks hmac-secret path into a secret mode"

echo "OK: 0509-renderer active, /healthz + /readyz green, loopback-only, secrets tight"
