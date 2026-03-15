#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
checks_command="${AUTORESEARCH_CHECKS_COMMAND:-npm run lint}"

cd "$repo_root"

exec bash -lc "$checks_command"
