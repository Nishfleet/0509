## What

Re-queue of Nish-ratified EPIC #1367 (full-site watch) after the senior-auditor panel discard was reversed (mechanism fix: fleet-ops#4451). This PR ships the **planner packet** only — no code.

Task #1955 asks for three things; the first two were done as out-of-band GitHub metadata (issue bodies already carried the spec-gate fields, labels/blocked-on wiring applied, re-queue comments posted). This PR is the third: the missing `docs/epics/2026-08-28-full-site-watch.md` epic doc, mirroring the two existing epic docs (`2026-08-28-auto-competitor-watch.md`, `2026-08-28-mention-monitoring.md`), with a §6 table of the five active scoped items and their labels.

## What was verified

- **Spec-gate bodies (already present, re-verified):** all five target issues pass `lib/agent-ready-spec-gate.py check-body` (exit 0):
  `#1382`, `#1383`, `#1384`, `#1386`, `#1387` → `SPEC-GATE: ok`.
- **Labels:** all five now carry `agent-ready`; `agent-blocked` and `discarded` removed. Dependency ordering via machine-checkable `blocked-on:` body lines (intake blocker filter holds them while the dependee is open): `#1384` → `Nishfleet/0509#1383`, `#1386` → `Nishfleet/0509#1384`, `#1387` → `Nishfleet/0509#1383`. `#1382`/`#1383` carry no blocker (ready now).
- **Accept check:** `gh issue list -R Nishfleet/0509 --search "EPIC #1367" --state open --json labels` → zero `discarded`.
- **Re-queue comments:** one "re-queued: Nish-ratified EPIC #1367; panel discard reversed (fleet-ops#4451)" comment posted per issue.
- **No-agent-names:** `bin/fleet-no-agent-names-check --commit-range origin/main..HEAD` → `OK: no agent attribution detected`.

## Verification

run-proof: docs-only PR (new markdown epic doc); no code, no new units/timers/workflows. Gates run:
- `lib/agent-ready-spec-gate.py check-body` on `/tmp/isseue1955/{1382,1383,1384,1386,1387}.body.md` → `SPEC-GATE: ok` (x5)
- `bin/fleet-no-agent-names-check --commit-range origin/main..HEAD` → exit 0
- `gh issue list -R Nishfleet/0509 --search "EPIC #1367" --state open --json labels` → 0 with `discarded`

net-positive-because: a planning document is additive by nature — the epic doc is the durable record the fleet needs to re-queue #1367's items; it records the re-queued queue, not machinery.

## Reviewer round (product PR, one round)

Reviewer seat: `cursor/cursor-grok-4.6-high` (first usable in `senior_seats_in_order`; `bin/fleet-review-arm-check` exit 0).

- **Act on:** none.
- **Consider:** (1) stale `monitoring.server.ts:2189` line number carried from the source plan — `runWebsiteSiteScanForWatchlist` actually lives at `:4818`; **fixed** (dropped the line number). (2) spec-gate tool-name divergence (`agent-ready-spec-gate.py` vs siblings' `fleet-spec-gate.sh`) — §6 already cites the live `lib/agent-ready-spec-gate.py check-body`; no change needed.
- **Noted:** fleet-tool paths are referenced by name (external to this product repo), consistent with the sibling docs.
- **Dismissed-with-reason:** none.

## Adjudication

All reviewer findings landed in exactly one bucket: Consider (2, non-blocking; 1 fixed), Noted (1). No Act-on findings, so no re-delegation was required before arming.

Closes #1955
