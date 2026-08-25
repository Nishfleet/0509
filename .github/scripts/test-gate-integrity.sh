#!/usr/bin/env bash
# test-gate-integrity.sh — deterministic fixture regression for the 0509
# gate-integrity decision logic.
#
# Exercises the exact shipped bytes of gate-integrity.sh against fixed context
# bundles (no network, no mutation). Every fixture pins a verdict; the waiver
# fixtures also pin the OUTPUT, because a waiver that is not loud is not a
# waiver — it is a silent bypass with extra steps.
#
# Exit 0 only when every fixture behaves exactly as pinned.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DECISION="$SCRIPT_DIR/gate-integrity.sh"
PASS_COUNT=0
FAIL_COUNT=0
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gi-fixtures.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT

HEAD="1111111111111111111111111111111111111111"
OLD="2222222222222222222222222222222222222222"

GATE_GLOBS='[".github/workflows/**",".github/scripts/**",".github/CODEOWNERS",".gitleaksignore",".gitleaks.toml",".semgrepignore",".semgrep.yml",".semgrep.yaml","scripts/design-system-ratchet.mjs","docs/design-system-ratchet.json","scripts/ci-vitest-run.sh","scripts/ci-verify-*.sh"]'

# build_bundle <name> — reads a python expression from $FIXTURE_SRC.
build_bundle() {
  local name="$1"
  FIXTURE_SRC="$FIXTURE_SRC" GATE_GLOBS="$GATE_GLOBS" HEAD="$HEAD" OLD="$OLD" \
    python3 - "$WORK_DIR/$name.json" <<'PY'
import json, os, sys
HEAD = os.environ["HEAD"]
OLD = os.environ["OLD"]
GATE_GLOBS = json.loads(os.environ["GATE_GLOBS"])
# Shorthands the fixture expressions below refer to by name.
ADMIN = {"nish3451": "admin"}
ATTEST = [{"user": "nish3451", "sha": HEAD}]
# Deterministic fixture data; eval is safe here (no untrusted input).
bundle = eval(os.environ["FIXTURE_SRC"])
bundle.setdefault("head_sha", HEAD)
bundle.setdefault("gate_globs", GATE_GLOBS)
bundle.setdefault("commit_messages", [])
bundle.setdefault("pr_body", "")
bundle.setdefault("attestations", [])
bundle.setdefault("permissions", {})
with open(sys.argv[1], "w") as fh:
    json.dump(bundle, fh)
PY
}

# run_fixture <name> <PASS|FAIL> [must-contain] [must-not-contain]
run_fixture() {
  local name="$1" expected="$2" must_contain="${3:-}" must_not_contain="${4:-}"
  local rc=0 out="" ok=0 why=""
  out="$(bash "$DECISION" < "$WORK_DIR/$name.json")" || rc=$?
  if [[ "$expected" == "PASS" && $rc -eq 0 && "$out" == *"PASS:"* ]]; then ok=1; fi
  # Both verdicts are matched anywhere in the output, not anchored at the
  # start: a bundle may legitimately emit `::notice::` lines (e.g. an
  # oversized diff with no patch) before the verdict line.
  if [[ "$expected" == "FAIL" && $rc -ne 0 && "$out" == *"FAIL:"* ]]; then ok=1; fi
  if [[ $ok -eq 1 && -n "$must_contain" && "$out" != *"$must_contain"* ]]; then
    ok=0; why=" (missing expected output: $must_contain)"
  fi
  if [[ $ok -eq 1 && -n "$must_not_contain" && "$out" == *"$must_not_contain"* ]]; then
    ok=0; why=" (found forbidden output: $must_not_contain)"
  fi
  if [[ $ok -eq 1 ]]; then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf 'ok   %s\n' "$name"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf 'FAIL %s: expected %s, got rc=%s%s\n' "$name" "$expected" "$rc" "$why"
    printf '%s\n' "$out" | sed 's/^/       | /'
  fi
}

fixture() { FIXTURE_SRC="$2"; build_bundle "$1"; }


# --- clean diffs ------------------------------------------------------------
fixture ordinary '{"files": [{"filename": "app/routes/home.tsx", "status": "modified", "patch": "+const x = 1"}]}'
run_fixture ordinary PASS

fixture tests_added '{"files": [{"filename": "tests/new.test.ts", "status": "added", "patch": "+it(\"works\", () => { expect(1).toBe(1); });"}]}'
run_fixture tests_added PASS

fixture test_refactor_net_positive '{"files": [
  {"filename": "tests/a.test.ts", "status": "modified", "patch": "-it(\"a\", () => {});\n+it(\"a\", () => {});\n+it(\"b\", () => {});"}]}'
run_fixture test_refactor_net_positive PASS

# --- test-integrity: deletion ----------------------------------------------
fixture test_deleted '{"files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}]}'
run_fixture test_deleted FAIL "test file deleted: tests/auth.test.ts"

fixture test_deleted_justified_commit '{
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}],
  "commit_messages": ["test: fold auth cases into session suite\n\ntest-removal-justified: cases moved verbatim to tests/session.test.ts"]}'
run_fixture test_deleted_justified_commit PASS "test-integrity waived"

fixture test_deleted_justified_body '{
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}],
  "pr_body": "Closes #1\n\ntest-removal-justified: suite replaced by the workerd integration suite"}'
run_fixture test_deleted_justified_body PASS "test-integrity waived"

fixture test_trailer_empty '{
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}],
  "commit_messages": ["chore\n\ntest-removal-justified:"]}'
run_fixture test_trailer_empty FAIL "no \`test-removal-justified:\` trailer"

# --- test-integrity: rename out of the suite --------------------------------
fixture test_renamed_away '{"files": [
  {"filename": "app/lib/old-auth-checks.ts", "previous_filename": "tests/auth.test.ts", "status": "renamed", "patch": "+// moved"}]}'
run_fixture test_renamed_away FAIL "renamed out of the suite"

fixture test_renamed_within '{"files": [
  {"filename": "tests/auth-v2.test.ts", "previous_filename": "tests/auth.test.ts", "status": "renamed", "patch": "+// moved"}]}'
run_fixture test_renamed_within PASS

# --- test-integrity: skip/only/todo -----------------------------------------
fixture test_skipped '{"files": [
  {"filename": "tests/auth.test.ts", "status": "modified", "patch": "-it(\"a\", () => {});\n+it.skip(\"a\", () => {});"}]}'
run_fixture test_skipped FAIL "test disabled in tests/auth.test.ts"

fixture test_only '{"files": [
  {"filename": "tests/auth.test.ts", "status": "modified", "patch": "-describe(\"a\", () => {});\n+describe.only(\"a\", () => {});"}]}'
run_fixture test_only FAIL "test disabled in tests/auth.test.ts"

fixture test_xit '{"files": [
  {"filename": "tests/auth.test.ts", "status": "modified", "patch": "+xit(\"a\", () => {});"}]}'
run_fixture test_xit FAIL "test disabled in tests/auth.test.ts"

fixture skip_marker_in_app_code '{"files": [
  {"filename": "app/lib/queue.ts", "status": "modified", "patch": "+  // it.skip is mentioned here in a comment"}]}'
run_fixture skip_marker_in_app_code PASS

# --- test-integrity: net assertion loss -------------------------------------
fixture assertions_gutted '{"files": [
  {"filename": "tests/auth.test.ts", "status": "modified",
   "patch": "-  expect(a).toBe(1);\n-  expect(b).toBe(2);\n-  expect(c).toBe(3);\n+  // TODO"}]}'
run_fixture assertions_gutted FAIL "net assertion count fell by 3"

fixture assertions_gutted_justified '{
  "files": [{"filename": "tests/auth.test.ts", "status": "modified",
             "patch": "-  expect(a).toBe(1);\n-  expect(b).toBe(2);\n-  expect(c).toBe(3);\n+  // TODO"}],
  "commit_messages": ["test-removal-justified: assertions moved into the property-based suite"]}'
run_fixture assertions_gutted_justified PASS "test-integrity waived"

# --- gate-path: workflow edits ----------------------------------------------
fixture workflow_edited '{"files": [
  {"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}]}'
run_fixture workflow_edited FAIL "gate-owned path changed"

fixture workflow_edited_attested '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture workflow_edited_attested PASS "gate-path waived"

fixture workflow_attested_stale '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": [{"user": "nish3451", "sha": OLD}], "permissions": ADMIN}'
run_fixture workflow_attested_stale FAIL "stale: a newer commit was pushed after it"

fixture workflow_attested_nonadmin '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": [{"user": "worker", "sha": HEAD}], "permissions": {"worker": "write"}}'
run_fixture workflow_attested_nonadmin FAIL "not admin"

fixture workflow_attested_maintainer '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": [{"user": "m", "sha": HEAD}], "permissions": {"m": "maintain"}}'
run_fixture workflow_attested_maintainer FAIL "not admin"

fixture workflow_deleted '{"files": [
  {"filename": ".github/workflows/gate-integrity.yml", "status": "removed", "patch": "-name: gate-integrity"}]}'
run_fixture workflow_deleted FAIL "gate-owned path changed (removed)"

fixture gate_script_deleted '{"files": [
  {"filename": ".github/scripts/gate-integrity.sh", "status": "removed", "patch": "-set -euo pipefail"}]}'
run_fixture gate_script_deleted FAIL "gate-owned path changed (removed)"

fixture codeowners_edited '{"files": [
  {"filename": ".github/CODEOWNERS", "status": "modified", "patch": "-* @nish3451\n+"}]}'
run_fixture codeowners_edited FAIL "gate-owned path changed"

# --- gate-path: ignore files ------------------------------------------------
fixture gitleaksignore_edited '{"files": [
  {"filename": ".gitleaksignore", "status": "modified", "patch": "+abc123:app/secret.ts:generic-api-key:1"}]}'
run_fixture gitleaksignore_edited FAIL "gate-owned path changed"

fixture semgrepignore_added '{"files": [
  {"filename": ".semgrepignore", "status": "added", "patch": "+app/"}]}'
run_fixture semgrepignore_added FAIL "gate-owned path changed"

# --- gate-path: CI softeners ------------------------------------------------
fixture ci_softener_or_true '{"files": [
  {"filename": ".github/workflows/uptime-health.yml", "status": "modified", "patch": "+          npm run check || true"}]}'
run_fixture ci_softener_or_true FAIL "CI step softened"

fixture ci_softener_continue '{"files": [
  {"filename": ".github/workflows/uptime-health.yml", "status": "modified", "patch": "+        continue-on-error: true"}]}'
run_fixture ci_softener_continue FAIL "CI step softened"

fixture softener_in_ungated_script '{"files": [
  {"filename": "scripts/local-helper.sh", "status": "modified", "patch": "+  grep foo bar || true"}]}'
run_fixture softener_in_ungated_script FAIL "CI step softened"

# Prose that NAMES a banned construct is not that construct. The very first run
# of this check against real PR data flagged its own workflow header, because
# the header contains a sentence explaining what `|| true` does.
fixture softener_in_yaml_comment '{"files": [
  {"filename": ".github/workflows/gate-integrity.yml", "status": "added",
   "patch": "+# a PR can append `|| true` or `continue-on-error: true` to a CI step"}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture softener_in_yaml_comment PASS "gate-path waived" "CI step softened"

fixture skip_in_test_comment '{"files": [
  {"filename": "tests/auth.test.ts", "status": "modified",
   "patch": "+  // do not use it.skip here; the gate rejects it"}]}'
run_fixture skip_in_test_comment PASS

# Commenting a test OUT is still a real assertion loss, so comment exclusion
# must apply symmetrically to added and removed lines, never only to added.
fixture assertions_commented_out '{"files": [
  {"filename": "tests/auth.test.ts", "status": "modified",
   "patch": "-  expect(a).toBe(1);\n-  expect(b).toBe(2);\n+  // expect(a).toBe(1);\n+  // expect(b).toBe(2);"}]}'
run_fixture assertions_commented_out FAIL "net assertion count fell by 2"

# --- gate-path: ratchet weakening -------------------------------------------
fixture ratchet_raised '{"files": [
  {"filename": "docs/design-system-ratchet.json", "status": "modified",
   "patch": "-  \"raw-hex-color\": 258,\n+  \"raw-hex-color\": 400,"}]}'
run_fixture ratchet_raised FAIL "raised 258 -> 400"

fixture ratchet_key_deleted '{"files": [
  {"filename": "docs/design-system-ratchet.json", "status": "modified",
   "patch": "-  \"css-important\": 26,"}]}'
run_fixture ratchet_key_deleted FAIL "was deleted (was 26)"

fixture ratchet_lowered '{"files": [
  {"filename": "docs/design-system-ratchet.json", "status": "modified",
   "patch": "-  \"raw-hex-color\": 258,\n+  \"raw-hex-color\": 12,"}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture ratchet_lowered PASS "gate-path waived" "raised"

fixture ratchet_script_edited '{"files": [
  {"filename": "scripts/design-system-ratchet.mjs", "status": "modified", "patch": "+// tweak"}]}'
run_fixture ratchet_script_edited FAIL "gate-owned path changed"

# --- both classes at once ---------------------------------------------------
fixture both_classes '{"files": [
  {"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"},
  {"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}]}'
run_fixture both_classes FAIL "test file deleted"

fixture both_classes_one_remedy '{
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"},
            {"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture both_classes_one_remedy FAIL "no \`test-removal-justified:\` trailer"

fixture both_classes_both_remedies '{
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"},
            {"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "commit_messages": ["test-removal-justified: folded into the workerd suite"],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture both_classes_both_remedies PASS "gate-path waived"

# --- an attestation must never waive a test-integrity violation -------------
fixture attestation_does_not_waive_tests '{
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture attestation_does_not_waive_tests FAIL "test file deleted"

# --- a trailer must never waive a gate-path violation -----------------------
fixture trailer_does_not_waive_gate '{
  "files": [{"filename": ".gitleaksignore", "status": "modified", "patch": "+abc:app/x.ts:key:1"}],
  "commit_messages": ["test-removal-justified: unrelated"]}'
run_fixture trailer_does_not_waive_gate FAIL "gate-owned path changed"

# --- waivers must be loud ---------------------------------------------------
fixture clean_is_quiet '{"files": [{"filename": "README.md", "status": "modified", "patch": "+text"}]}'
run_fixture clean_is_quiet PASS "" "::warning"

# --- fail closed ------------------------------------------------------------
printf 'not json' > "$WORK_DIR/malformed.json"
run_fixture malformed FAIL "context bundle is not valid JSON"

printf '[]' > "$WORK_DIR/not_object.json"
run_fixture not_object FAIL "context bundle is not a JSON object"

printf '{"files": "nope"}' > "$WORK_DIR/files_not_array.json"
run_fixture files_not_array FAIL "context bundle files is not an array"

fixture missing_head_sha '{
  "head_sha": "",
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  x: 1"}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture missing_head_sha FAIL "attestation currency cannot be proven"

fixture no_patch_on_gate_path '{"files": [
  {"filename": ".github/workflows/ci.yml", "status": "modified"}]}'
run_fixture no_patch_on_gate_path FAIL "gate-owned path changed"

fixture no_patch_on_deleted_test '{"files": [
  {"filename": "tests/auth.test.ts", "status": "removed"}]}'
run_fixture no_patch_on_deleted_test FAIL "test file deleted"

printf '\n%s passed, %s failed\n' "$PASS_COUNT" "$FAIL_COUNT"
test "$FAIL_COUNT" -eq 0
