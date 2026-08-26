#!/usr/bin/env bash
# Bind an exact-main remote-restore candidate manifest for deploy prepare.
# Called directly as a `run:` step from deploy-production.yml.
set -euo pipefail
umask 077

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

node scripts/customer-readiness-candidate.mjs --base HEAD \
  > "$RUNNER_TEMP/d1-remote-restore-candidate.json"
node scripts/build-remote-restore-candidate-manifest.mjs \
  --candidate "$RUNNER_TEMP/d1-remote-restore-candidate.json" \
  --output "$RUNNER_TEMP/d1-remote-restore-candidate-manifest.json"
