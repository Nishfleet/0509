#!/usr/bin/env bash
# D1 query budget trip-wire (issue #1731). Estimates the app's daily D1 row
# footprint via EXPLAIN QUERY PLAN against the migrated schema plus declared
# canary consumption, and fails when the estimate exceeds the configured
# fraction of the D1 free-tier daily limit.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --no-warnings scripts/ci-d1-budget-check.lib.mjs "$@"
