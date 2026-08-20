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
#   maintainer-permission approval, unapproved deploy-chain edit
#   (deploy-production.yml), approved deploy-chain edit by a non-author
#   admin, unapproved deploy-chain script edit (ci-verify-production-candidate.sh).
#
# Sole-admin attestation path (owner decision, Nish, 2026-08-20) fixtures:
#   current admin attestation by the PR author (PASS + loud warning), stale
#   attestation naming a superseded sha (FAIL), attestation by a non-admin
#   (FAIL), attestation by a maintainer rather than an admin (FAIL),
#   attestation with a missing head sha (FAIL), attestation on an unprotected
#   PR (PASS with no warning), independent review winning over a present
#   attestation (PASS with no warning), mixed-case attested sha (PASS),
#   attestation while a stale one is also present (PASS), and the failure
#   message documenting BOTH remedies.
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

# run_fixture <name> <PASS|FAIL> <bundle.json> [must-contain] [must-not-contain]
# The two optional arguments pin the OUTPUT, not just the verdict: the
# sole-admin attestation path is only acceptable if it is loud, so its
# fixtures assert the warning annotation is present when that path is taken
# and absent when it is not.
run_fixture() {
  local name="$1" expected="$2" json_file="$3" must_contain="${4:-}" must_not_contain="${5:-}"
  local rc=0 out=""
  out="$(bash "$DECISION" < "$json_file")" || rc=$?
  local ok=0 why=""
  if [[ "$expected" == "PASS" && $rc -eq 0 && "$out" == PASS:* ]]; then ok=1; fi
  if [[ "$expected" == "FAIL" && $rc -ne 0 && "$out" == FAIL:* ]]; then ok=1; fi
  if [[ $ok -eq 1 && -n "$must_contain" && "$out" != *"$must_contain"* ]]; then
    ok=0
    why=" (missing expected output: $must_contain)"
  fi
  if [[ $ok -eq 1 && -n "$must_not_contain" && "$out" == *"$must_not_contain"* ]]; then
    ok=0
    why=" (found forbidden output: $must_not_contain)"
  fi
  if [[ $ok -eq 1 ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    echo "  ok   $name (rc=$rc)"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "  FAIL $name (expected $expected, rc=$rc)$why"
    echo "       out: $out"
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

# 17. Unapproved deploy-workflow edit: deploy-production.yml changed, zero
#     reviews -> FAIL (deploy authorization must not be redefinable without
#     independent approval)
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/deploy-production.yml", "previous_filename": None}],
  "reviews": [],
  "permissions": {},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh", ".github/workflows/deploy-production.yml", ".github/workflows/finalize-production-soak.yml", "scripts/ci-verify-production-candidate.sh", "scripts/ci-verify-provider-main-cas.sh"]
}'
build_bundle "17-deploy-unapproved"
run_fixture "unapproved deploy-workflow edit fails" FAIL "$WORK_DIR/17-deploy-unapproved.json"

# 18. Approved deploy-workflow edit: deploy-production.yml changed, current
#     non-author admin APPROVED -> PASS
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": ".github/workflows/deploy-production.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "alice"}],
  "permissions": {"alice": "admin"},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh", ".github/workflows/deploy-production.yml", ".github/workflows/finalize-production-soak.yml", "scripts/ci-verify-production-candidate.sh", "scripts/ci-verify-provider-main-cas.sh"]
}'
build_bundle "18-deploy-approved"
run_fixture "approved deploy-workflow edit passes" PASS "$WORK_DIR/18-deploy-approved.json"

# 19. Unapproved deploy-chain script edit: ci-verify-production-candidate.sh
#     changed, zero reviews -> FAIL
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "files": [{"filename": "scripts/ci-verify-production-candidate.sh", "previous_filename": None}],
  "reviews": [],
  "permissions": {},
  "protected_files": [".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh", ".github/workflows/deploy-production.yml", ".github/workflows/finalize-production-soak.yml", "scripts/ci-verify-production-candidate.sh", "scripts/ci-verify-provider-main-cas.sh"]
}'
build_bundle "19-deploy-script-unapproved"
run_fixture "unapproved deploy-chain script edit fails" FAIL "$WORK_DIR/19-deploy-script-unapproved.json"

# ---------------------------------------------------------------------------
# Sole-admin attestation path (owner decision, Nish, 2026-08-20).
#
# Nishfleet/0509 has one collaborator and GitHub forbids self-approval, so the
# independent-review path above cannot be satisfied here. These fixtures pin
# the second remedy: an exact-match `verifier-attest: <head sha>` comment from
# a repository ADMIN. They assert the verdict AND the loudness — the path is
# only acceptable while it announces itself.
# ---------------------------------------------------------------------------

# Deterministic shas shared by the attestation fixtures.
ATTEST_HEAD="a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"
ATTEST_HEAD_MIXED="A1B2C3D4E5F60718293A4B5C6D7E8F9012345678"
ATTEST_OLD="0000111122223333444455556666777788889999"
ATTEST_PROTECTED='[".github/workflows/ci.yml", ".github/workflows/secret-scan.yml", ".github/workflows/required-verifier-integrity.yml", ".github/scripts/required-verifier-integrity.sh", ".github/scripts/test-required-verifier-integrity.sh", ".github/workflows/deploy-production.yml", ".github/workflows/finalize-production-soak.yml", "scripts/ci-verify-production-candidate.sh", "scripts/ci-verify-provider-main-cas.sh"]'

# 20. Current admin attestation by the sole admin (who is also the PR author),
#     protected change, zero reviews -> PASS, and the output must be loud.
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": "scripts/ci-verify-provider-main-cas.sh", "previous_filename": None}],
  "reviews": [],
  "attestations": [{"user": "nish3451", "sha": "'"$ATTEST_HEAD"'"}],
  "permissions": {"nish3451": "admin"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "20-attest-current"
run_fixture "current admin attestation passes" PASS "$WORK_DIR/20-attest-current.json" \
  "::warning title=Verifier integrity: sole-admin attestation"

# 20b. The same fixture must name the attesting admin and the attested sha.
run_fixture "attestation warning names the admin and sha" PASS "$WORK_DIR/20-attest-current.json" \
  "Repository admin nish3451 attested head sha $ATTEST_HEAD"

# 21. Stale attestation: the comment names a sha the PR has moved past -> FAIL.
#     This is what makes new commits invalidate old attestations.
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [],
  "attestations": [{"user": "nish3451", "sha": "'"$ATTEST_OLD"'"}],
  "permissions": {"nish3451": "admin"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "21-attest-stale"
run_fixture "stale attestation (superseded sha) fails" FAIL "$WORK_DIR/21-attest-stale.json" \
  "stale: a newer commit was pushed after it"

# 22. Attestation by a non-admin collaborator (write) -> FAIL.
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [],
  "attestations": [{"user": "bob", "sha": "'"$ATTEST_HEAD"'"}],
  "permissions": {"bob": "write"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "22-attest-nonadmin"
run_fixture "non-admin attestation fails" FAIL "$WORK_DIR/22-attest-nonadmin.json" \
  "not admin; the sole-admin path requires repository admin"

# 23. Attestation by a maintainer -> FAIL. `maintain` is enough to APPROVE
#     independently, but not to attest alone.
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [],
  "attestations": [{"user": "carol", "sha": "'"$ATTEST_HEAD"'"}],
  "permissions": {"carol": "maintain"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "23-attest-maintain"
run_fixture "maintainer attestation fails (admin required)" FAIL "$WORK_DIR/23-attest-maintain.json"

# 24. Attestation with a missing head sha -> FAIL closed (currency unprovable).
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [],
  "attestations": [{"user": "nish3451", "sha": "'"$ATTEST_HEAD"'"}],
  "permissions": {"nish3451": "admin"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "24-attest-no-head-sha"
run_fixture "attestation with missing head sha fails closed" FAIL "$WORK_DIR/24-attest-no-head-sha.json" \
  "attestation currency cannot be proven"

# 25. Attestation present but no protected file changed -> PASS via rule 1,
#     and NOT via the attestation path (no warning; the path was never used).
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": "app/routes/app.clients.tsx", "previous_filename": None}],
  "reviews": [],
  "attestations": [{"user": "nish3451", "sha": "'"$ATTEST_HEAD"'"}],
  "permissions": {"nish3451": "admin"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "25-attest-unprotected"
run_fixture "attestation on an unprotected PR passes quietly" PASS "$WORK_DIR/25-attest-unprotected.json" \
  "" "::warning"

# 26. Independent review AND attestation both present -> the review path wins,
#     so the run stays quiet. The independent path must not be weakened or
#     shadowed by the fallback.
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "APPROVED", "submitted_at": "2026-08-13T17:10:00Z", "user": "alice"}],
  "attestations": [{"user": "nish3451", "sha": "'"$ATTEST_HEAD"'"}],
  "permissions": {"alice": "admin", "nish3451": "admin"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "26-review-wins"
run_fixture "independent review is preferred over attestation" PASS "$WORK_DIR/26-review-wins.json" \
  "approved by an independent admin/maintainer" "::warning"

# 27. Mixed-case attested sha is normalized -> PASS (the workflow lowercases,
#     and the decision logic lowercases again so a hand-pasted sha still works).
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [],
  "attestations": [{"user": "nish3451", "sha": "'"$ATTEST_HEAD_MIXED"'"}],
  "permissions": {"nish3451": "admin"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "27-attest-mixed-case"
run_fixture "mixed-case attested sha passes" PASS "$WORK_DIR/27-attest-mixed-case.json" \
  "::warning title=Verifier integrity: sole-admin attestation"

# 28. A stale attestation followed by a current one -> PASS (the current one
#     still counts; a re-attest after a new commit is the normal flow).
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [{"state": "COMMENTED", "submitted_at": "2026-08-13T17:05:00Z", "user": "nish3451"}],
  "attestations": [{"user": "nish3451", "sha": "'"$ATTEST_OLD"'"}, {"user": "nish3451", "sha": "'"$ATTEST_HEAD"'"}],
  "permissions": {"nish3451": "admin"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "28-attest-restated"
run_fixture "re-attestation after a new commit passes" PASS "$WORK_DIR/28-attest-restated.json" \
  "::warning title=Verifier integrity: sole-admin attestation"

# 29. Malformed attestations field (not an array) -> FAIL closed.
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [],
  "attestations": "verifier-attest: '"$ATTEST_HEAD"'",
  "permissions": {"nish3451": "admin"},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "29-attest-malformed"
run_fixture "malformed attestations field fails closed" FAIL "$WORK_DIR/29-attest-malformed.json" \
  "attestations is not an array"

# 30/31. No approval and no attestation -> FAIL, and the failure must document
#        BOTH remedies so the reader is never left guessing.
FIXTURE_SRC='{
  "author": "nish3451",
  "head_commit_date": "2026-08-13T17:00:00Z",
  "head_sha": "'"$ATTEST_HEAD"'",
  "files": [{"filename": ".github/workflows/ci.yml", "previous_filename": None}],
  "reviews": [],
  "attestations": [],
  "permissions": {},
  "protected_files": '"$ATTEST_PROTECTED"'
}'
build_bundle "30-no-remedy"
run_fixture "failure documents the independent-review remedy" FAIL "$WORK_DIR/30-no-remedy.json" \
  "1. Independent review (preferred"
run_fixture "failure documents the attestation remedy" FAIL "$WORK_DIR/30-no-remedy.json" \
  "verifier-attest: <40-hex current head sha>"

echo ""
if [[ $FAIL_COUNT -eq 0 ]]; then
  echo "ALL FIXTURES PASS ($PASS_COUNT/$PASS_COUNT)"
  exit 0
else
  echo "$FAIL_COUNT FIXTURE FAILURE(S) ($PASS_COUNT passed)"
  exit 1
fi
