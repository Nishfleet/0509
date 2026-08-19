#!/usr/bin/env bash
# required-verifier-integrity.sh — deterministic decision logic for the
# 0509 required-verifier integrity gate (sol-sweep
# product-ci/0509-required-verifiers-self-certify-without-independent-approval).
#
# Reads a context bundle JSON from stdin and prints PASS (exit 0) or FAIL
# (exit 1). It performs no network access and no repository mutation: it is
# pure decision logic so the deterministic fixture regression
# (test-required-verifier-integrity.sh) can exercise the exact shipped bytes.
#
# Context bundle shape:
# {
#   "author": "nish3451",                       # PR author login
#   "head_commit_date": "2026-08-13T17:00:00Z", # PR head commit committer date
#   "files": [{"filename": ".github/workflows/ci.yml",
#              "previous_filename": null}],     # authoritative PR changed-file list
#   "reviews": [{"state": "APPROVED",
#                "submitted_at": "2026-08-13T17:05:00Z",
#                "user": "alice"}],             # PR review list (paginated, merged)
#   "permissions": {"alice": "admin"},          # collaborator permission per reviewer
#   "protected_files": [".github/workflows/ci.yml",
#                       ".github/workflows/secret-scan.yml",
#                       ".github/workflows/required-verifier-integrity.yml",
#                       ".github/scripts/required-verifier-integrity.sh",
#                       ".github/scripts/test-required-verifier-integrity.sh",
#                       ".github/workflows/deploy-production.yml",
#                       ".github/workflows/finalize-production-soak.yml",
#                       "scripts/ci-verify-production-candidate.sh",
#                       "scripts/ci-verify-provider-main-cas.sh"]
# }
#
# Rule (fail closed):
#   * If no protected verifier definition changed (by filename or
#     previous_filename), PASS.
#   * If a protected verifier definition changed (required-verifier workflows,
#     the gate's decision scripts, or the production deploy-authorization
#     chain: deploy-production.yml, finalize-production-soak.yml,
#     ci-verify-production-candidate.sh, ci-verify-provider-main-cas.sh),
#     PASS only when the reviews list contains a CURRENT independent approval:
#     state == APPROVED, reviewer != PR author, reviewer permission is admin
#     or maintain, and submitted_at >= head_commit_date. Anything else (no
#     approval, dismissed, commented, stale, self-approval, insufficient
#     permission, unparseable bundle, missing head date) FAILS.
set -euo pipefail

# The bundle is read here (bash), then handed to python by argv: python's own
# stdin is consumed by the heredoc below, so the bundle can never live on
# python's stdin.
bundle="$(cat)"

python3 - "$bundle" <<'PY'
import json
import sys
from datetime import datetime, timezone


def fail(reasons):
    print("FAIL: protected verifier definition changed without a current independent approval")
    for why in reasons:
        print(f"  - {why}")
    return 1


def parse_ts(value):
    """GitHub ISO-8601 timestamps look like 2026-08-13T17:05:00Z."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def main():
    try:
        bundle = json.loads(sys.argv[1])
    except (json.JSONDecodeError, UnicodeDecodeError, IndexError) as exc:
        # Fail closed: an unparseable context bundle must never pass.
        return fail([f"context bundle is not valid JSON: {exc}"])

    if not isinstance(bundle, dict):
        return fail(["context bundle is not a JSON object"])

    author = bundle.get("author") or ""
    head_date = parse_ts(bundle.get("head_commit_date") or "")
    files = bundle.get("files") or []
    reviews = bundle.get("reviews") or []
    permissions = bundle.get("permissions") or {}
    protected = set(bundle.get("protected_files") or [])

    if not isinstance(files, list) or not isinstance(reviews, list):
        return fail(["context bundle files/reviews are not arrays"])

    protected_changed = []
    for f in files:
        if not isinstance(f, dict):
            return fail(["context bundle file entry is not an object"])
        name = f.get("filename")
        prev = f.get("previous_filename")
        if name in protected:
            protected_changed.append(name)
        if prev in protected:
            protected_changed.append(prev)

    if not protected_changed:
        print("PASS: no protected verifier definition changed")
        return 0

    if head_date is None:
        # Without the head commit date, "current" cannot be proven: fail closed.
        return fail(["head commit date missing or unparseable; approval currency cannot be proven"])

    reasons = []
    for r in reviews:
        if not isinstance(r, dict):
            reasons.append("review entry is not an object")
            continue
        if r.get("state") != "APPROVED":
            reasons.append(f"review by {r.get('user') or 'unknown'} is {r.get('state') or 'no state'}, not APPROVED")
            continue
        user = r.get("user") or ""
        if user == author:
            reasons.append(f"self-approval by the PR author {author}")
            continue
        perm = permissions.get(user)
        if perm not in ("admin", "maintain"):
            reasons.append(f"approver {user} has permission {perm!r}, not admin/maintain")
            continue
        submitted = parse_ts(r.get("submitted_at"))
        if submitted is None:
            reasons.append(f"approval by {user} has an unparseable submitted_at")
            continue
        if submitted < head_date:
            reasons.append(f"approval by {user} predates the current head commit (stale)")
            continue
        print("PASS: protected verifier change approved by an independent admin/maintainer")
        return 0

    return fail(reasons) if reasons else fail(["no review in the reviews list"])


sys.exit(main())
PY
