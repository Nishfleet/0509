#!/usr/bin/env bash
# 0509 Netcup renderer — rollback to the previous installed source backup.
# Picks the newest .bak-* of renderer-server.mjs, restores it, reloads the unit.
set -euo pipefail

INSTALL_DIR="${RENDERER_INSTALL_DIR:-$HOME/.local/share/0509-renderer}"

backup="$(ls -1t "${INSTALL_DIR}/src"/renderer-server.mjs.bak-* 2>/dev/null | head -n 1 || true)"
if [[ -z "${backup}" ]]; then
  echo "no renderer source backup found; nothing to roll back" >&2
  exit 1
fi
cp -p "${backup}" "${INSTALL_DIR}/src/renderer-server.mjs"
echo "restored ${backup} -> ${INSTALL_DIR}/src/renderer-server.mjs"
systemctl --user restart 0509-renderer.service
systemctl --user is-active --quiet 0509-renderer.service || { echo "FAIL: service not active after rollback" >&2; exit 1; }
echo "OK: 0509-renderer rolled back and active"
