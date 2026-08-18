# 0509 — Merge-or-Kill Stale Branches (recorded 2026-08-18)

**Item:** [0509] merge-or-kill stale branches (anonymous-search-429,
d1-restore-deflake v1/v2, checkout-session-auth v1/v2,
terminal-webhook-replay, codex/0509-browser-*) — each gets landed or deleted
with a dated note.

**Status:** COMPLETE. Every named branch was triaged against `main`
(`ea036094`) on 2026-08-18. Each branch was either already landed in `main`
(so the redundant local ref was deleted), killed as a redundant/stale subset,
or landed via a fresh PR. Disposition per branch below.

## Disposition table

| Branch | Disposition | Evidence (as of 2026-08-18) |
| --- | --- | --- |
| `fix/anonymous-search-429-rate-limit` | **KILLED — already landed** | `app/lib/customer-route-error.ts` and the Retry-After forwarding path in `app/routes/search.tsx` (lines ~166-174, ~350-358) are already in `main`. Redundant local ref deleted. |
| `fix/d1-remote-restore-cancel-deflake` (v1) | **KILLED — already merged** | `git merge-base --is-ancestor` confirms the branch tip is an ancestor of `main`. Redundant local ref deleted. |
| `fix/d1-remote-restore-cancel-deflake-v2` | **KILLED — already landed** | The `/proc`-identity de-flake in `tests/d1-remote-restore-evidence.test.ts` (lines ~84-122) is already in `main`. Redundant local ref deleted. |
| `fix/0509-checkout-session-auth-coverage` | **KILLED — already landed** | `tests/dodo-checkout.route.test.ts` blob hash is identical to `main` (`56c4e8b1…`); session-auth/workspace-ownership coverage already present. Redundant local ref deleted. |
| `fix/0509-checkout-session-auth-coverage-v2` | **KILLED — already landed** | Same test file, identical blob hash to `main`. Redundant local ref deleted. |
| `test/0509-terminal-webhook-replay-reclaim` | **KILLED — already landed** | `tests/dodo-billing-webhook-lease-atomicity.test.ts` (replay-stays-duplicate / zero-mutation proof) is already in `main`. Redundant local ref deleted. |
| `codex/0509-browser-attribution` | **KILLED — redundant subset** | Its tree is a strict subset of `codex/0509-browser-integration` (all shared files byte-identical; integration adds auth-login/search/brand-page coverage). Content preserved via the integration PR. Local ref deleted. |
| `codex/0509-browser-integration` | **LANDED** | Browser-job telemetry feature (migration `0075_browser_job_telemetry.sql`, `app/lib/browser-job-telemetry.server.ts`, attribution across ad-source/browser-run/landing-pages/meta-library, tests). Merges cleanly into `main` (0 conflicts). Landed via PR. |
| `codex/0509-netcup-browser-v2` | **LANDED** | Bounded loopback-only netcup browser-rendering foundation (`ops/netcup-browser/` — auth, engine, job-queue, renderer-server, url-policy, deploy, tests, runbook). Merges cleanly into `main` (0 conflicts). Landed via PR. |

## Notes

- The five "already landed" branches were deleted locally only; none had a
  remote ref to clean up.
- Six of the killed branches were checked out in stale worktrees under
  `agent-worktrees/` and `agent-state/sol-sweep/` (all dated 2026-08-13). Those
  stale worktrees were removed and the redundant local refs deleted.
- The `fix/0509-checkout-session-auth-coverage-v2` worktree carried uncommitted,
  unrelated funnel-measurement implementation (not present in `main`; only
  `docs/funnel-measurement-spec.md` exists there). That work was preserved on a
  new branch `wip/funnel-measurement-20260813` before the worktree was removed.
- `codex/0509-browser-attribution` was killed rather than landed because
  `codex/0509-browser-integration` is a strict superset of it — landing both
  would duplicate the same migration and telemetry code.
- The two landed browser branches were pushed to `origin` and opened as PRs so
  CI can verify the full suite before merge.
