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
#   "author": "nish3451",                       # PR author login (implementer)
#   "pusher": "nishfleet-worker[bot]",           # head-commit GitHub login
#   "implementers": ["..."],                    # optional extra implementer logins
#   "head_commit_date": "2026-08-13T17:00:00Z", # PR head commit committer date
#   "head_sha": "0123...def",                   # PR head sha, 40 lowercase hex
#   "files": [{"filename": ".github/workflows/ci.yml",
#              "previous_filename": null}],     # authoritative PR changed-file list
#   "reviews": [{"state": "APPROVED",
#                "submitted_at": "2026-08-13T17:05:00Z",
#                "user": "alice"}],             # PR review list (paginated, merged)
#   "attestations": [{"user": "nish3451",
#                     "sha": "0123...def"}],    # exact-match attestation comments
#   "permissions": {"alice": "admin"},          # collaborator permission per
#                                               # reviewer AND attesting commenter
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
# Rule (fail closed), evaluated strictly in this order:
#
#   1. If no protected verifier definition changed (by filename or
#      previous_filename), PASS.
#
#   2. INDEPENDENT-REVIEW PATH (first-class; unchanged). If a protected
#      verifier definition changed (required-verifier workflows, the gate's
#      decision scripts, or the production deploy-authorization chain:
#      deploy-production.yml, finalize-production-soak.yml,
#      ci-verify-production-candidate.sh, ci-verify-provider-main-cas.sh),
#      PASS when the reviews list contains a CURRENT independent approval:
#      state == APPROVED, reviewer != PR author, reviewer permission is admin
#      or maintain, and submitted_at >= head_commit_date. This remains the
#      preferred remedy and is tried before anything else; the moment a second
#      admin/maintainer exists on this repository it is the only path that
#      should ever be used.
#
#   3. SOLE-ADMIN ATTESTATION PATH (owner decision, Nish, 2026-08-20).
#      Nishfleet/0509 has exactly one collaborator, and GitHub forbids
#      approving your own pull request, so rule 2 is structurally
#      unsatisfiable here: every protected change would be permanently
#      blocked. Rather than silently allowing self-approval (which would
#      destroy the audit trail), the gate accepts an explicit, loud, recorded
#      attestation: PASS when the PR carries a comment whose entire body is
#      exactly
#
#          verifier-attest: <40-hex sha>
#
#      where the sha equals the PR's CURRENT head sha and the comment author
#      has ADMIN permission on the repository. Admin permission is resolved
#      through the collaborator-permission API by the base-branch-owned
#      workflow, never from author_association (which an outside contributor
#      can carry as OWNER/MEMBER-looking values) and never from a candidate
#      file. The attester MAY be the PR author only on a human-only PR (no
#      worker identity among implementers). When nishfleet-worker[bot]
#      implemented the change, a different identity must attest; the worker
#      can never attest (0509#1140 / fleet-ops#413). Currency is proven by sha
#      equality rather than by
#      timestamps, so pushing any new commit invalidates every prior
#      attestation automatically, exactly as a new commit dismisses a stale
#      approval in rule 2. Taking this path is never quiet: the gate prints a
#      GitHub ::warning:: annotation and writes a job-summary entry naming the
#      attesting admin, the attested sha, and the fact that no independent
#      reviewer was involved.
#
#   4. Otherwise FAIL, printing BOTH remedies. Anything else (no approval, no
#      attestation, dismissed, commented, stale approval, stale attestation,
#      self-approval, insufficient reviewer permission, non-admin attester,
#      unparseable bundle, missing head date, missing/malformed head sha)
#      FAILS.
set -euo pipefail

# The bundle is read here (bash), then handed to python by argv: python's own
# stdin is consumed by the heredoc below, so the bundle can never live on
# python's stdin.
bundle="$(cat)"

python3 - "$bundle" <<'PY'
import json
import os
import re
import sys
from datetime import datetime, timezone

HEX40 = re.compile(r"^[0-9a-f]{40}$")

# GitHub App login that implements fleet PRs. A member of this set can never
# attest, and its presence among implementers forbids owner self-attest.
DEFAULT_WORKER_IDENTITIES = ("nishfleet-worker[bot]",)


def norm_login(login):
    if not isinstance(login, str):
        return ""
    return login.strip().lower()


def collect_implementers(bundle):
    """PR author + pusher (+ optional implementers list) as GitHub logins."""
    out = set()
    for key in ("author", "pusher"):
        n = norm_login(bundle.get(key) or "")
        if n:
            out.add(n)
    extra = bundle.get("implementers")
    if isinstance(extra, list):
        for item in extra:
            n = norm_login(item)
            if n:
                out.add(n)
    return out


def apply_actions_event_implementers(bundle):
    """Fill missing author from the GitHub Actions event payload.

    pull_request_target already writes GITHUB_EVENT_PATH. Reading it is a
    local file, not network, so fixtures stay hermetic when GITHUB_ACTIONS
    is unset. Bundle author always wins when already set. Live
    required-verifier-integrity.yml already passes author; this is the
    same fallback gate-integrity uses until 0509#1176 lands.
    """
    if os.environ.get("GITHUB_ACTIONS") != "true":
        return
    if norm_login(bundle.get("author") or ""):
        return
    path = os.environ.get("GITHUB_EVENT_PATH") or ""
    if not path or not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8") as fh:
            event = json.load(fh)
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return
    if not isinstance(event, dict):
        return
    pr = event.get("pull_request")
    if not isinstance(pr, dict):
        return
    user = pr.get("user")
    if not isinstance(user, dict):
        return
    login = user.get("login")
    if isinstance(login, str) and login.strip():
        bundle["author"] = login.strip()


def identity_rejects_attestor(user, implementers):
    """Reason this attestor is forbidden, or None.

    Same rules as fleet-ops lib/attest-identity-gate.py (fleet-ops#413):
      1. A worker identity can never attest.
      2. Overlap + a worker among implementers → same-identity REJECT.
      3. Overlap with no worker implementer → owner self-attest, allowed.
    """
    attestor = norm_login(user)
    if not attestor:
        return None
    workers = {norm_login(x) for x in DEFAULT_WORKER_IDENTITIES}
    if attestor in workers:
        return f"worker identity cannot attest: {user}"
    if attestor in implementers and (implementers & workers):
        return f"same identity implemented and attested: {user}"
    return None

REMEDIES = """
Two remedies unblock this PR. Either one is sufficient.

  1. Independent review (preferred, and the only path used once this
     repository has a second admin/maintainer): a repository admin or
     maintainer OTHER than the PR author submits an APPROVED review whose
     submission time is at or after the current head commit's date.

  2. Sole-admin attestation (this repository currently has one collaborator,
     and GitHub forbids approving your own pull request, so remedy 1 cannot
     be satisfied here): a repository ADMIN posts a pull-request comment whose
     ENTIRE body is exactly

         verifier-attest: <40-hex current head sha>

     then re-runs this check. Admin permission is verified through the
     collaborator-permission API, not from the comment itself. The sha must
     equal the PR's current head sha, so pushing any new commit invalidates
     the attestation and a fresh one is required. Using this path emits a
     loud warning annotation and a job-summary entry naming the admin and the
     sha, because no independent reviewer saw the change. The attestor must
     be a different GitHub login from the implementers (PR author / pusher)
     when a worker identity is among them; nishfleet-worker[bot] can never
     attest.
""".rstrip()


def fail(reasons, remedies=False):
    print("FAIL: protected verifier definition changed without a current independent approval or admin attestation")
    for why in reasons:
        print(f"  - {why}")
    if remedies:
        print(REMEDIES)
    return 1


def announce_sole_admin(user, sha, protected_changed):
    """Make the sole-admin path impossible to miss in the log and the summary."""
    changed = ", ".join(sorted(set(protected_changed)))
    message = (
        f"Sole-admin attestation path used. Repository admin {user} attested head sha {sha}. "
        f"NO independent reviewer approved this change. Protected files changed: {changed}. "
        "This path exists only because Nishfleet/0509 has one collaborator and GitHub forbids "
        "self-approval (owner decision, Nish, 2026-08-20). It must stop being used as soon as a "
        "second admin/maintainer exists. Any new commit invalidates this attestation."
    )
    print(f"::warning title=Verifier integrity: sole-admin attestation, no independent review::{message}")

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    entry = (
        "### :warning: required-verifier-integrity: sole-admin attestation\n\n"
        f"- **Attesting admin:** `{user}` (admin permission verified through the collaborator-permission API)\n"
        f"- **Attested head sha:** `{sha}`\n"
        f"- **Protected files changed:** `{changed}`\n"
        "- **Independent review:** none — no second reviewer approved this change.\n"
        "- **Why this path exists:** Nishfleet/0509 has one collaborator and GitHub forbids "
        "self-approval, so the independent-review path is structurally unsatisfiable "
        "(owner decision, Nish, 2026-08-20).\n"
        "- **Invalidated by:** any new commit — the attested sha stops matching the head sha.\n\n"
    )
    try:
        with open(summary_path, "a", encoding="utf-8") as fh:
            fh.write(entry)
    except OSError as exc:
        # Never silent: the decision still stands, but say the record failed.
        print(f"::warning::could not write the sole-admin attestation entry to the job summary: {exc}")


def find_attestation(attestations, permissions, head_sha, reasons, implementers):
    """Return (user, sha) for the first valid current admin attestation, else None."""
    if not isinstance(attestations, list):
        reasons.append("context bundle attestations is not an array")
        return None
    if not attestations:
        return None
    if not head_sha:
        # Without a well-formed head sha, an attestation's currency cannot be
        # proven: fail closed rather than trusting the comment's own sha.
        reasons.append("head sha missing or malformed; attestation currency cannot be proven")
        return None
    for a in attestations:
        if not isinstance(a, dict):
            reasons.append("attestation entry is not an object")
            continue
        user = a.get("user") or ""
        if not user:
            reasons.append("attestation comment has no resolvable author")
            continue
        blocked = identity_rejects_attestor(user, implementers)
        if blocked:
            reasons.append(blocked)
            continue
        raw_sha = a.get("sha")
        if not isinstance(raw_sha, str):
            reasons.append(f"attestation by {user} carries a non-string sha")
            continue
        sha = raw_sha.strip().lower()
        perm = permissions.get(user)
        if perm != "admin":
            reasons.append(
                f"attesting commenter {user} has permission {perm!r}, not admin; "
                "the sole-admin path requires repository admin"
            )
            continue
        if not HEX40.match(sha):
            reasons.append(f"attestation by {user} does not carry a 40-hex sha")
            continue
        if sha != head_sha:
            reasons.append(
                f"attestation by {user} names sha {sha}, not the current head sha "
                f"{head_sha} (stale: a newer commit was pushed after it)"
            )
            continue
        return user, sha
    return None


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
    raw_head_sha = bundle.get("head_sha")
    head_sha = raw_head_sha.strip().lower() if isinstance(raw_head_sha, str) else ""
    if not HEX40.match(head_sha):
        head_sha = ""
    files = bundle.get("files") or []
    reviews = bundle.get("reviews") or []
    attestations = bundle.get("attestations") or []
    permissions = bundle.get("permissions") or {}
    extra_implementers = bundle.get("implementers")
    if extra_implementers is not None and not isinstance(extra_implementers, list):
        return fail(["context bundle implementers is not an array"])
    apply_actions_event_implementers(bundle)
    implementers = collect_implementers(bundle)
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

    reasons = []

    # Path 1 (preferred, unchanged): a current independent APPROVED review.
    # Without the head commit date, an approval's currency cannot be proven, so
    # the whole review path is skipped and recorded as a reason — exactly the
    # same outcome as before for a review-only bundle, while still letting the
    # attestation path below stand on its own (it proves currency by sha, not
    # by date).
    if head_date is None:
        reasons.append("head commit date missing or unparseable; approval currency cannot be proven")
    for r in reviews:
        if head_date is None:
            break
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

    # Path 2 (sole-admin fallback): an exact-match attestation comment from a
    # repository admin naming the CURRENT head sha. Only reached when path 1
    # found no current independent approval.
    attested = find_attestation(
        attestations, permissions, head_sha, reasons, implementers
    )
    if attested is not None:
        user, sha = attested
        print("PASS: protected verifier change accepted via the sole-admin attestation path")
        announce_sole_admin(user, sha, protected_changed)
        return 0

    if not reasons:
        reasons.append("no review in the reviews list and no attestation comment on the pull request")
    return fail(reasons, remedies=True)


sys.exit(main())
PY
