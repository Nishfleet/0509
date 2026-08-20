#!/usr/bin/env bash
# 0509 Netcup renderer — install (idempotent).
# Backs up anything it would overwrite; never touches other services.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${RENDERER_INSTALL_DIR:-$HOME/.local/share/0509-renderer}"
CONFIG_DIR="${RENDERER_CONFIG_DIR:-$HOME/.config/0509-renderer}"
UNIT_SRC="${SRC_DIR}/deploy/0509-renderer.service"
UNIT_DST="${HOME}/.config/systemd/user/0509-renderer.service"

mkdir -p "${INSTALL_DIR}/src" "${INSTALL_DIR}/artifacts" "${INSTALL_DIR}/tmp" "${CONFIG_DIR}"

# 1. Copy source (never overwrite silently — timestamped backup first).
if [[ -f "${INSTALL_DIR}/src/renderer-server.mjs" ]]; then
  cp -p "${INSTALL_DIR}/src/renderer-server.mjs" \
    "${INSTALL_DIR}/src/renderer-server.mjs.bak-$(date +%Y%m%d%H%M%S)"
fi
cp -p "${SRC_DIR}/src/"*.mjs "${INSTALL_DIR}/src/"
cp -p "${SRC_DIR}/CONTRACT.md" "${INSTALL_DIR}/CONTRACT.md" 2>/dev/null || true

# 2. Provision the HMAC secret once (never logged, never in the repo).
if [[ ! -s "${CONFIG_DIR}/hmac-secret" ]]; then
  umask 077
  node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex") + "\n")' > "${CONFIG_DIR}/hmac-secret"
fi
chmod 600 "${CONFIG_DIR}/hmac-secret" 2>/dev/null || true
if [[ -f "${CONFIG_DIR}/hmac-secret.prev" ]]; then
  chmod 600 "${CONFIG_DIR}/hmac-secret.prev" 2>/dev/null || true
fi

# 3. Default public env (loopback only — never bind non-loopback here).
if [[ ! -f "${CONFIG_DIR}/public.env" ]]; then
  cat > "${CONFIG_DIR}/public.env" <<'EOF'
RENDERER_PORT=9382
RENDERER_BIND=127.0.0.1
RENDERER_PDF_ORIGIN=https://0509.io
RENDERER_CAMOFOX_BASE=http://127.0.0.1:9377
EOF
fi
# Optional secrets env (CAMOFOX access key) is read if present; never created here.
chmod 600 "${CONFIG_DIR}/secrets.env" 2>/dev/null || true

# 4. Install the user unit with the install dir baked in.
mkdir -p "$(dirname "${UNIT_DST}")"
sed "s|__INSTALL_DIR__|${INSTALL_DIR}|g" "${UNIT_SRC}" > "${UNIT_DST}.tmp"
if [[ -f "${UNIT_DST}" ]] && ! cmp -s "${UNIT_DST}" "${UNIT_DST}.tmp"; then
  cp -p "${UNIT_DST}" "${UNIT_DST}.bak-$(date +%Y%m%d%H%M%S)"
fi
mv "${UNIT_DST}.tmp" "${UNIT_DST}"

systemctl --user daemon-reload
systemctl --user enable 0509-renderer.service
echo "installed: ${UNIT_DST} (install dir ${INSTALL_DIR})"
