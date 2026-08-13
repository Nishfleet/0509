#!/usr/bin/env bash
# test-required-verifier-integrity.sh — deterministic fixture regression for
# the 0509 required-verifier integrity gate decision logic.
#
# Exercises the exact shipped bytes of required-verifier-integrity.sh against
# fixed context bundles (no network, no mutation):
#   ordinary PR, unapproved verifier-edit, commented-only verifier-edit,
#   approved verifier-edit, self-approval, stale approval, dismissed approval,
#   insufficient-permission approval, paginated inputs, rename into a
#   protected path, integrity-workflow self-edit, malformed bundle (API
#   failure analog: must fail closed), missing head date (fail closed),
#   maintainer-permission approval.
# Exit 0 only when every fixture behaves exactly as pinned.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DECISION="$SCRIPT_DIR/required-verifier-integrity.sh"
PASS_COUNT=0
FAIL_COUNT=0
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rvi-fixtures.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT


# Build a fixture bundle file from a python3 expression in $FIXTURE_SRC.
build_bundle() {
  local name="$1"
  FIXTURE_SRC="$FIXTURE_SRC" python3 - "$WORK_DIR/$name.json" <<'PY'
import json, os, sys
src = os.environ["FIXTURE_SRC"]
# Deterministic fixture data; eval is safe here (no untrusted input).
bundle = eval(src)
with open(sys.argv[1], "w") as fh:
    json.dump(bundle, fh)
PY
}

run_fixture() {
  local name="$1" expected="$2" json_file="$3"
  local rc=0 out=""
  out="$(bash "$DECISION" < "$json_file")" || rc=$?
  local ok=0
  if [[ "$expected" == "PASS" && $rc -eq 0 && "$out" == PASS:* ]]; then ok=1; fi
  if [[ "$expected" == "FAIL" && $rc -ne 0 && "$out" == FAIL:* ]]; then ok=1; fi
  if [[ $ok -eq 1 ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  ok   $name (rc=$rc)"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  FAIL $name (expected $expected, rc=$rc, out: $out)"
  fi
}

echo "required-verifier-integrity fixture regression"

# 1. Ordinary PR: no protected file touched, no reviews -> PASS
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": "app/routes/app.clients.tsx", "previous_filename": None}],
  "reviews": [],
  "permissions": {},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "01-ordinary"
run_fixture "ordinary PR passes" PASS "$WORK_DIR/01-ordinary.json"

# 2. Unapproved verifier-edit: ci.yml changed, zero reviews -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [],
  "permissions": {},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "02-unapproved"
run_fixture "unapproved verifier edit fails" FAIL "$WORK_DIR/02-unapproved.json"

# 3. Commented-only verifier-edit: admin commented but never approved -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/secret-scan.yml", "previous_filename": None}],
  "reviews": [{"state": "COMMENTED", "submitted_at": "2026-08-13T17:10:00Z", "user": "alice"}],
  "permissions": {"alice": "admin"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "03-commented"
run_fixture "commented-only verifier edit fails" FAIL "$WORK_DIR/03-commented.json"

# 4. Approved verifier-edit by a different admin, submitted after the head commit -> PASS
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "alice"}],
  "permissions": {"alice": "admin"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "04-approved"
run_fixture "approved verifier edit passes" PASS "$WORK_DIR/04-approved.json"

# 5. Self-approval: PR author approves own verifier edit -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "nish3451"}],
  "permissions": {"nish3451": "admin"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "05-self"
run_fixture "self-approval fails" FAIL "$WORK_DIR/05-self.json"

# 6. Stale approval: approved before the current head commit -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T16:00:00Z", "user": "alice"}],
  "permissions": {"alice": "admin"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "06-stale"
run_fixture "stale approval fails" FAIL "$WORK_DIR/06-stale.json"

# 7. Dismissed approval -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "DISMISSED", "submitted_at": "2026-08-13T17:10:00Z", "user": "alice"}],
  "permissions": {"alice": "admin"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "07-dismissed"
run_fixture "dismissed approval fails" FAIL "$WORK_DIR/07-dismissed.json"

# 8. Insufficient permission: write collaborator approves -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "bob"}],
  "permissions": {"bob": "write"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "08-write"
run_fixture "write-permission approval fails" FAIL "$WORK_DIR/08-write.json"

# 9. Maintainer-permission approval -> PASS (maintain counts)
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "carol"}],
  "permissions": {"carol": "maintain"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "09-maintain"
run_fixture "maintainer-permission approval passes" PASS "$WORK_DIR/09-maintain.json"

# 10. Pagination: 150 reviews with the valid approval at index 140 (page 2),
#     and 120 files with the protected change late in the list -> PASS
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"],
  "files": [{"filename": "app/routes/file%d.tsx" % i, "previous_filename": None} for i in range(119)] + [{"filename": ".github/workflows/secret-scan.yml", "previous_filename": None}],
  "reviews": [{"state": "COMMENTED", "submitted_at": "2026-08-13T17:01:00Z", "user": "bot%d" % i} for i in range(140)] + [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "alice"}] + [{"state": "COMMENTED", "submitted_at": "2026-08-13T17:01:00Z", "user": "tailbot%d" % i} for i in range(9)],
  "permissions": {"alice": "admin"}
}'
build_bundle "10-pagination"
run_fixture "paginated inputs (150 reviews, 120 files) pass" PASS "$WORK_DIR/10-pagination.json"

# 11. Rename into a protected path (previous_filename = ci.yml) without approval -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci-copy.yml", "previous_filename": ".github/workflows/ci.yml"}],
  "reviews": [],
  "permissions": {},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "11-rename"
run_fixture "rename into protected path fails" FAIL "$WORK_DIR/11-rename.json"

# 12. Integrity workflow self-edit: the gate's own workflow changed without approval -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/required-verifier-integrity.yml", "previous_filename": None}],
  "reviews": [],
  "permissions": {},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "12-self-edit"
run_fixture "integrity workflow self-edit fails" FAIL "$WORK_DIR/12-self-edit.json"

# 13. Decision-script self-edit without approval -> FAIL (gate logic is protected too)
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/scripts/required-verifier-integrity.sh", "previous_filename": None}],
  "reviews": [],
  "permissions": {},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "13-script-edit"
run_fixture "decision script self-edit fails" FAIL "$WORK_DIR/13-script-edit.json"

# 14. API failure analog: malformed bundle must fail closed (never pass) -> FAIL
printf 'not json at all {{' > "$WORK_DIR/14-malformed.json"
run_fixture "malformed bundle fails closed" FAIL "$WORK_DIR/14-malformed.json"

# 15. Missing head commit date with a verifier change -> FAIL (currency unprovable)
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "alice"}],
  "permissions": {"alice": "admin"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "15-no-head-date"
run_fixture "missing head date fails closed" FAIL "$WORK_DIR/15-no-head-date.json"

# 16. Multiple protected files changed, one valid independent approval -> PASS
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}, {"filename": ".github/workflows/secret-scan.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "alice"}],
  "permissions": {"alice": "admin"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh"]
}'
build_bundle "16-multi"
run_fixture "multi-file verifier change with approval passes" PASS "$WORK_DIR/16-multi.json"

echo ""
if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "ALL FIXTURES PASS ($PASS_COUNT/$PASS_COUNT)"
  exit 0
else
  echo "$FAIL_COUNT FIXTURE FAILURE(S) ($PASS_COUNT passed)"
  exit 1
fi
