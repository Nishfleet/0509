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
# Worker identity (nishfleet-worker[bot]) and an admin permissions block that
# also recognises the worker, for the identity-separation fixtures (0509#1140
# / fleet-ops#413). The same shorthand names are used by
# test-required-verifier-integrity.sh.
WORKER_BOT = "nishfleet-worker[bot]"
WORKER_ADMIN = {"nish3451": "admin", WORKER_BOT: "admin"}
WORKER_SELF_ATTEST = [{"user": WORKER_BOT, "sha": HEAD}]
# A multi-line attest comment body in the real-world #1273 shape: the marker
# line first, then verifier-attest, then review prose. Built with Python
# string concatenation so HEAD (a Python variable in this eval context) is
# interpolated, not bash-expanded into broken quoting.
MULTILINE_ATTEST_BODY = (
    "gate-integrity-attest: " + HEAD + "\n"
    "verifier-attest: " + HEAD + "\n\n"
    "Orchestrator attestation after diff review: SHA-pinned codecov action "
    "(v7), per-shard tokenless uploads, non-fatal during evaluate phase (a "
    "Codecov outage cannot block PRs), no check weakened, no required context "
    "altered. Promotion to required stays gated on 3 consecutive reliable "
    "reports per the PR body's plan."
)
# A comment whose body merely mentions the marker in prose — must NOT attest.
PROSE_MENTION_BODY = (
    "I would post gate-integrity-attest: " + HEAD + " here but this sentence "
    "is prose, not the marker line itself."
)
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

# --- identity separation (0509#1140 / fleet-ops#413) -----------------------
# Implementer (PR author / pusher) and attestor must be DIFFERENT GitHub
# logins, and a worker identity (nishfleet-worker[bot]) can never attest. The
# worker can have admin permission — the rule is not about permission, it is
# about who pushed the code. Owner self-attest of a human-only PR still
# passes; that is the sole-admin path, not a worker hole.
#
# Mirrors fleet-ops#413 (lib/attest-identity-gate.py) so both repos refuse
# the same combinations. The fixtures cover the three classes named in the
# issue plus the human-only owner self-attest regression and the GITHUB_EVENT
# fallback that lets the rule fire live when the workflow cannot pass author.

# Worker implements and self-attests -> REJECT (worker cannot attest, AND
# same identity implemented and attested). The same fixture exercises both
# rules at once.
fixture worker_implements_self_attests '{
  "author": WORKER_BOT, "pusher": WORKER_BOT,
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": WORKER_SELF_ATTEST, "permissions": WORKER_ADMIN}'
run_fixture worker_implements_self_attests FAIL "worker identity cannot attest"

# Worker implements, human admin attests -> PASS (the cross-identity happy
# path: the implementer is the worker, the attestor is the human admin).
fixture worker_implements_human_attests '{
  "author": WORKER_BOT, "pusher": WORKER_BOT,
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": WORKER_ADMIN}'
run_fixture worker_implements_human_attests PASS "gate-path waived"

# Human implements, worker attests -> REJECT (worker can never attest, even
# on a human-authored PR). Admin permission is irrelevant.
fixture human_implements_worker_attests '{
  "author": "nish3451", "pusher": "nish3451",
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": WORKER_SELF_ATTEST, "permissions": WORKER_ADMIN}'
run_fixture human_implements_worker_attests FAIL "worker identity cannot attest"

# Owner self-attest of a human-only PR -> PASS (the sole-admin path, still
# allowed when no worker identity is among the implementers). This is the
# regression the issue calls out: the human-token path is not retired.
fixture human_only_owner_self_attests '{
  "author": "nish3451", "pusher": "nish3451",
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture human_only_owner_self_attests PASS "gate-path waived"

# Implementer with extra logins via `implementers` array still REJECTS the
# same-identity case. The list is additive: a worker mention in the
# implementers list counts the same as the author being a worker.
fixture implementers_list_worker_self_attests '{
  "author": "nish3451", "pusher": "nish3451", "implementers": [WORKER_BOT],
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": WORKER_ADMIN}'
run_fixture implementers_list_worker_self_attests FAIL "same identity implemented and attested"

# --- GITHUB_EVENT_PATH fallback (0509#1140) ---------------------------------
# gate-integrity.yml cannot pass `author` today (nishfleet-worker has no
# Workflows permission). On real CI, the decision script reads
# pull_request.user.login from GITHUB_EVENT_PATH so the identity split still
# fires. Bundle author wins when already set. A malformed event file must
# not crash the gate.

WORKER_EVENT='{"pull_request":{"user":{"login":"nishfleet-worker[bot]"}}}'

# No author in the bundle, the event payload names the worker -> the worker
# self-attest is REJECTED. This is the live wire-up the issue requires.
fixture actions_event_worker_self_attest '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": WORKER_SELF_ATTEST, "permissions": WORKER_ADMIN}'
printf '%s' "$WORKER_EVENT" > "$WORK_DIR/actions_event_worker_self_attest.event.json"
GITHUB_ACTIONS=true GITHUB_EVENT_PATH="$WORK_DIR/actions_event_worker_self_attest.event.json" \
  run_fixture actions_event_worker_self_attest FAIL "worker identity cannot attest"

# No author in the bundle, the event payload names the worker, human attests
# -> PASS (cross-identity happy path using the event-derived author).
fixture actions_event_worker_human_attest '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": WORKER_ADMIN}'
printf '%s' "$WORKER_EVENT" > "$WORK_DIR/actions_event_worker_human_attest.event.json"
GITHUB_ACTIONS=true GITHUB_EVENT_PATH="$WORK_DIR/actions_event_worker_human_attest.event.json" \
  run_fixture actions_event_worker_human_attest PASS "gate-path waived"

# Bundle author wins when already set (the event payload names the worker
# but the bundle author is the human; the human is treated as the
# implementer and the human self-attest is the sole-admin path, PASS).
fixture actions_event_does_not_override_bundle '{
  "author": "nish3451",
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": ADMIN}'
printf '%s' "$WORKER_EVENT" > "$WORK_DIR/actions_event_does_not_override_bundle.event.json"
GITHUB_ACTIONS=true GITHUB_EVENT_PATH="$WORK_DIR/actions_event_does_not_override_bundle.event.json" \
  run_fixture actions_event_does_not_override_bundle PASS "gate-path waived"

# A malformed event file must not crash the gate. Without a parseable
# author and without a worker mentioned, the human self-attest follows the
# sole-admin path -> PASS.
fixture actions_event_malformed '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": ADMIN}'
printf 'not json' > "$WORK_DIR/actions_event_malformed.event.json"
GITHUB_ACTIONS=true GITHUB_EVENT_PATH="$WORK_DIR/actions_event_malformed.event.json" \
  run_fixture actions_event_malformed PASS "gate-path waived"

# A missing event file (the workflow env var is set but the file is gone)
# must also not crash. Same PASS shape.
fixture actions_event_missing_file '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "attestations": ATTEST, "permissions": ADMIN}'
GITHUB_ACTIONS=true GITHUB_EVENT_PATH="$WORK_DIR/actions_event_missing_file.event.json" \
  run_fixture actions_event_missing_file PASS "gate-path waived"

# --- #1273 regression: multi-line attest comment (fleet-ops#828) -------------
# The real-world attest shape: the marker line is the FIRST line of a
# multi-line comment that also carries `verifier-attest:` and review prose.
# The workflow's old whole-body exact-match jq filter rejected this comment
# entirely, so the decision script saw an empty attestations array and failed
# with "no current gate-integrity-attest: <head sha> comment from a repository
# admin" against a comment whose first line matched the head sha exactly.
#
# These fixtures exercise the line-anchored extraction path: the bundle ships
# raw `comments` (the shape the fixed workflow delivers), and the decision
# script extracts the attest line itself. The shorthands MULTILINE_ATTEST_BODY
# and PROSE_MENTION_BODY are built in the build_bundle Python context with
# string concatenation against the HEAD variable.

fixture p1273_multiline_attest '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+        uses: codecov/codecov-action@v7"}],
  "comments": [{"body": MULTILINE_ATTEST_BODY, "user": "nish3451"}],
  "permissions": ADMIN}'
run_fixture p1273_multiline_attest PASS "gate-path waived"

# Same shape but the attest line is NOT the first line — extraction must find
# it anywhere in the body, not only at the top.
fixture multiline_attest_not_first_line '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "comments": [{"body": "Reviewing this PR now.\n\ngate-integrity-attest: " + HEAD + "\n\nLooks good.", "user": "nish3451"}],
  "permissions": ADMIN}'
run_fixture multiline_attest_not_first_line PASS "gate-path waived"

# Prose that merely MENTIONS the marker does not attest: the line must be the
# marker and nothing else. This is the security property the line-anchored
# match preserves.
fixture prose_mention_does_not_attest '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "comments": [{"body": PROSE_MENTION_BODY, "user": "nish3451"}],
  "permissions": ADMIN}'
run_fixture prose_mention_does_not_attest FAIL "no current \`gate-integrity-attest:"

# A multi-line attest whose sha is stale (does not match head) is rejected,
# exactly like the pre-extracted shape.
fixture multiline_attest_stale '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "comments": [{"body": "gate-integrity-attest: " + OLD + "\n\nprose", "user": "nish3451"}],
  "permissions": ADMIN}'
run_fixture multiline_attest_stale FAIL "stale: a newer commit was pushed after it"

# A multi-line attest by a non-admin is rejected.
fixture multiline_attest_nonadmin '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "comments": [{"body": "gate-integrity-attest: " + HEAD + "\n\nprose", "user": "worker"}],
  "permissions": {"worker": "write"}}'
run_fixture multiline_attest_nonadmin FAIL "not admin"

# CR characters in a multi-line attest body (Windows-style line endings) must
# not break extraction.
fixture multiline_attest_crlf '{
  "files": [{"filename": ".github/workflows/ci.yml", "status": "modified", "patch": "+  timeout-minutes: 30"}],
  "comments": [{"body": "gate-integrity-attest: " + HEAD + "\r\nverifier-attest: " + HEAD + "\r\n\r\nprose", "user": "nish3451"}],
  "permissions": ADMIN}'
run_fixture multiline_attest_crlf PASS "gate-path waived"

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

# A brand-new workflow cannot *soften* a step that did not exist, and a shell
# `test`/`[` conditional is not a CI test step even when it contains `|| true`.
fixture added_workflow_shell_guard '{"files": [
  {"filename": ".github/workflows/ratchet-auto-tighten.yml", "status": "added",
   "patch": "+          test -z \"$(git symbolic-ref --quiet HEAD 2>/dev/null || true)\""}]}'
run_fixture added_workflow_shell_guard FAIL "gate-owned path changed (added)" "CI step softened"

fixture added_workflow_shell_guard_attested '{
  "files": [{"filename": ".github/workflows/ratchet-auto-tighten.yml", "status": "added",
   "patch": "+          test -z \"$(git symbolic-ref --quiet HEAD 2>/dev/null || true)\""}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture added_workflow_shell_guard_attested PASS "gate-path waived" "CI step softened"

fixture modified_script_shell_guard '{"files": [
  {"filename": "scripts/local-helper.sh", "status": "modified",
   "patch": "+  test -z \"$(git symbolic-ref --quiet HEAD 2>/dev/null || true)\""}]}'
run_fixture modified_script_shell_guard PASS

fixture modified_script_bracket_guard '{"files": [
  {"filename": "scripts/local-helper.sh", "status": "modified",
   "patch": "+  [ 1 -eq 2 ] || true"}]}'
run_fixture modified_script_bracket_guard PASS

fixture modified_script_double_bracket_guard '{"files": [
  {"filename": "scripts/local-helper.sh", "status": "modified",
   "patch": "+  [[ 1 -eq 2 ]] || true"}]}'
run_fixture modified_script_double_bracket_guard PASS

fixture workflow_run_test_guard_attested '{
  "files": [{"filename": ".github/workflows/uptime-health.yml", "status": "modified",
   "patch": "+        run: test -z \"$(git symbolic-ref --quiet HEAD 2>/dev/null || true)\""}],
  "attestations": ATTEST, "permissions": ADMIN}'
run_fixture workflow_run_test_guard_attested PASS "gate-path waived" "CI step softened"

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

# --- auto-revert waiver ----------------------------------------------------
# The .github/workflows/auto-revert.yml workflow opens a revert PR for every
# failing push-to-main run. The undo is, by construction, the inverse of a
# commit that almost certainly added tests — so the gate would flag every
# auto-revert PR as test-integrity weakened unless it recognises the
# workflow's own signals. Three must agree before the waiver applies:
#   1. PR body opens with the workflow's verbatim sentence.
#   2. Every commit subject starts with git's `Revert "` prefix.
#   3. A sha-bound `gate-integrity-auto-revert:` comment exists.
# Missing any one falls through to the trailer check, which fails closed.

# 1+2+3 all present → waiver applies, the deletion is expected for a revert.
AUTO_REVERT_PR_BODY='Automatic revert opened because a push-to-main CI workflow went red.\n\n- Failing run: Deploy production — https://example/run/1\n- Reverts commit `abcdef0`: `Merge pull request #1 from foo/bar`\n- Failing checks: Deploy Worker'
# Wrapped in Python single-quotes so the literal " inside Revert "..." survives
# the bash→Python eval hop without breaking the outer JSON string.
AUTO_REVERT_COMMIT_REVERT="'''Revert \"Merge pull request #1 from foo/bar\"\n\nThis reverts commit abcdef0123456789abcdef0123456789abcdef01.'''"
AUTO_REVERT_ATTS='[{"user": "github-actions[bot]", "sha": HEAD}]'

fixture auto_revert_full_waiver '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "auto_revert_attestations": '"$AUTO_REVERT_ATTS"',
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});\n-it(\"b\", () => {});"}]}'
run_fixture auto_revert_full_waiver PASS "test-integrity waived"

# A real-world shape: the reverted merge removed an entire test file and
# dropped assertions across several others — net assertion delta is large
# and negative. The waiver must still apply because the workflow itself
# produced this diff.
fixture auto_revert_big_diff_waived '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "auto_revert_attestations": '"$AUTO_REVERT_ATTS"',
  "files": [
    {"filename": "tests/sanitize-text.server.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"},
    {"filename": "tests/creative-text.test.ts", "status": "modified",
     "patch": "-  expect(a).toBe(1);\n-  expect(b).toBe(2);\n-  expect(c).toBe(3);\n+  // refactor"}]}'
run_fixture auto_revert_big_diff_waived PASS "test-integrity waived"

# 1+2 but missing the attestation comment — fail closed, name the missing
# signal so the human knows exactly why the waiver did not apply.
fixture auto_revert_no_attest '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}]}'
run_fixture auto_revert_no_attest FAIL "no sha-bound \`gate-integrity-auto-revert:\`"

# 1+3 but the commits are NOT git reverts — a PR that opens with the
# workflow's sentence but whose commits were hand-written gets no
# exemption. The body opener alone is not enough.
fixture auto_revert_body_only '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ["chore: delete dead tests"],
  "auto_revert_attestations": '"$AUTO_REVERT_ATTS"',
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}]}'
run_fixture auto_revert_body_only FAIL "test file deleted"

# 2+3 but the body is paraphrased — also fail closed. The opener is a fixed
# string the workflow owns; matching only the subject prefix is not enough.
fixture auto_revert_paraphrased_body '{
  "pr_body": "This is a manual revert of the bad deploy commit.",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "auto_revert_attestations": '"$AUTO_REVERT_ATTS"',
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}]}'
run_fixture auto_revert_paraphrased_body FAIL "test file deleted"

# Stale auto-revert attestation: comment names a sha that is no longer the
# PR head. A force-push after the comment must invalidate the waiver,
# exactly like the admin attestation.
fixture auto_revert_stale_attest '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "auto_revert_attestations": [{"user": "github-actions[bot]", "sha": OLD}],
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}]}'
run_fixture auto_revert_stale_attest FAIL "stale: a newer commit was pushed after it"

# The gate-path clause is NOT waived on the auto-revert path. A revert of a
# gate-owned path still needs an admin attestation, because the auto-revert
# body only promises "the diff is the inverse of HEAD_SHA" — it does not
# promise HEAD_SHA did not weaken a gate.
fixture auto_revert_touches_gate '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "auto_revert_attestations": '"$AUTO_REVERT_ATTS"',
  "files": [
    {"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"},
    {"filename": ".github/workflows/auto-revert.yml", "status": "modified", "patch": "+  timeout-minutes: 5"}]}'
run_fixture auto_revert_touches_gate FAIL "gate-owned path changed"

# With BOTH the auto-revert waiver AND an admin attestation, the gate-path
# half passes (waived by admin) and the test-integrity half passes (waived
# by the auto-revert) — but the two waivers remain independent and each
# marks only its own clause.
fixture auto_revert_and_admin_attest '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "attestations": ATTEST, "permissions": ADMIN,
  "auto_revert_attestations": '"$AUTO_REVERT_ATTS"',
  "files": [
    {"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"},
    {"filename": ".github/workflows/auto-revert.yml", "status": "modified", "patch": "+  timeout-minutes: 5"}]}'
run_fixture auto_revert_and_admin_attest PASS "test-integrity waived"

# An auto-revert PR that doesn't actually delete tests stays clean: the
# waiver is not needed, but if every signal is in place the gate still
# passes quietly. This pins the no-op path so a future "always waive on
# auto-revert signal" regression is caught.
fixture auto_revert_no_test_changes '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "auto_revert_attestations": '"$AUTO_REVERT_ATTS"',
  "files": [{"filename": "app/lib/x.ts", "status": "modified", "patch": "+const y = 1"}]}'
run_fixture auto_revert_no_test_changes PASS "" "::warning"

# Malformed auto-revert attestation entry (wrong shape) must not crash the
# gate and must not produce a spurious waiver. The fixture exercises the
# `entry is not an object` branch.
fixture auto_revert_malformed_attest_entry '{
  "pr_body": "'"$AUTO_REVERT_PR_BODY"'",
  "commit_messages": ['"$AUTO_REVERT_COMMIT_REVERT"'],
  "auto_revert_attestations": ["not-an-object"],
  "files": [{"filename": "tests/auth.test.ts", "status": "removed", "patch": "-it(\"a\", () => {});"}]}'
run_fixture auto_revert_malformed_attest_entry FAIL "test file deleted"

# auto_revert_attestations present but not a list → fail closed (matches
# the existing type-validation contract for every other bundle field).
fixture auto_revert_attest_not_array '{
  "auto_revert_attestations": "oops",
  "files": [{"filename": "README.md", "status": "modified", "patch": "+x"}]}'
run_fixture auto_revert_attest_not_array FAIL "auto_revert_attestations is not an array"

printf '\n%s passed, %s failed\n' "$PASS_COUNT" "$FAIL_COUNT"
test "$FAIL_COUNT" -eq 0
