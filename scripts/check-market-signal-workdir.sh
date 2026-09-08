#!/usr/bin/env bash
# Pre-clean-checkout gate for the daily 0509 market-signal run (issue #1953).
#
# Detects the untracked-overwrite blocker that failed the 2026-09-08 morning
# run: an UNTRACKED file on disk whose path ALSO exists on origin/main. Git
# then refuses the HEAD -> origin/main fast-forward ("untracked working tree
# files would be overwritten by merge"), the run dies at the clean-checkout
# gate, and no report is written for the day.
#
# `git status --porcelain` alone cannot tell such a file apart from a plain
# scratch file; the distinguishing probe is `git cat-file -e origin/main:<path>`
# plus a content comparison. This script is that probe, made deterministic so
# the gate no longer depends on the runner model's judgment of a raw status.
#
# Wired up as `npm run signal:market:workdir-check` and mandated as the FIRST
# step of Evidence collection in automation/HERMES_MARKET_SIGNAL.md. The
# contract is read before anything else by every run and wins over the runner
# prompt, so a future conflicting left-over file stops the run before the
# fetch/clean gate instead of silently killing it there.
#
# Usage: scripts/check-market-signal-workdir.sh [WORKDIR]
#   WORKDIR defaults to $WORKDIR then $PWD. The market-signal unit sets
#   WORKDIR=/home/nish/workspaces/products/0509.
#
# Exit codes:
#   0  no blocker — the workdir may fetch and fast-forward
#   1  blocker — untracked file(s) at a path origin/main also has; the exact
#      paths are printed, do NOT fetch/checkout/publish, fail loud
#   2  operational failure (not a git work tree, fetch failed)
set -euo pipefail

WORKDIR="${1:-${WORKDIR:-$PWD}}"
cd "$WORKDIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "FATAL: not a git work tree: $WORKDIR" >&2
    exit 2
fi

# Read-only: updates only the origin/main tracking ref. The dangerous
# operation (checkout / fast-forward) is exactly what the daily gate must not
# attempt when a blocker exists — that protection is this probe.
git fetch -q origin main || {
    echo "FATAL: git fetch origin main failed in $WORKDIR" >&2
    exit 2
}

blockers=0
# -z: NUL-delimited so paths with spaces or newlines survive verbatim.
# --untracked-files=all: descend into untracked directories so each file under
# them is probed individually (a leftover file deep in an untracked folder is
# exactly the 2026-09-08 shape: tests/ad-aggression-page.render.test.tsx).
while IFS= read -r -d '' entry; do
    [[ "${entry:0:3}" == "?? " ]] || continue
    path="${entry:3}"
    # Only a BLOB on the ref can be overwritten by the fast-forward; a tree
    # (directory) at the same path is not an overwrite candidate.
    [[ "$(git cat-file -t "origin/main:$path" 2>/dev/null)" == "blob" ]] || continue
    if git show "origin/main:$path" | cmp -s - "$path"; then
        echo "BLOCKER: untracked '$path' has the same content as origin/main:$path but still blocks the fast-forward (untracked file at a ref path): move it aside or commit it, then re-run"
    else
        echo "BLOCKER: untracked '$path' conflicts with origin/main:$path (different content — an agent likely left un-saved work here): move it aside or commit it, then re-run"
    fi
    blockers=$((blockers + 1))
done < <(git status --porcelain -z --untracked-files=all)

if ((blockers > 0)); then
    echo "FAIL: $blockers untracked-overwrite blocker(s) in $WORKDIR — do NOT fetch or fast-forward; resolve the file(s) above, then re-run" >&2
    exit 1
fi

echo "OK: no untracked-overwrite blocker in $WORKDIR"