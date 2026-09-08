## Why

Issue #1959 is a no-code planner-packet sort: read every open `discarded` 0509 issue and sort each into A (real product work, re-queue with a spec), B (fleet/CI-only or already done, close with a reason), or C (genuinely bad idea, keep discarded). The sort was performed on GitHub — issue rewrites, relabels, closes, and one summary comment. This PR is the paper closure record; no repo code changes.

## Scope

- Adds `docs/discarded-sweep-1959-2026-09-08.md`, a verification record re-stating the sort outcome and the live evidence.

## Verification

Live state verified on this date:

- `gh issue list -R Nishfleet/0509 --label discarded --state open --json number -q length` -> `0` (C count named in the summary was 0).
- 10/10 A issues pass the spec gate `lib/agent-ready-spec-gate.py check-body` (Nishfleet/fleet-ops tooling; rc=0 each), no longer carry `discarded`, and were re-queued (downstream intake has since drawn them into `agent-in-progress`/`agent-blocked`/`scout-candidate`).
- 40/40 B issues are `CLOSED` with a reason.
- C = 0.
- No new labels invented. No code shipped. Count frame reconciled (issue's 55/49 pre-#1955 stale vs 50 live pool) in the record.

run-proof: gh issue list + agent-ready-spec-gate.py check-body (fleet-ops), 10/10 rc=0; 40/40 B closed; discarded count 0.

## Review

Reviewer seat: minimax / MiniMax-M3.

- Act on: count frame (issue 55/49 vs live 50) — reconciled in the record. Fixed.
- Consider: gate-script path not checkable from 0509 — cited Nishfleet/fleet-ops lib/agent-ready-spec-gate.py. Fixed.
- Consider: `agent-ready` / ready-pool snapshot — timestamped as-of 2026-09-08 and noted downstream draw-down. Fixed.
- Noted: ready pool now below the 15 accept figure — transient within-intake-tick criterion; documented.

## Closes #1959
