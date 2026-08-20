# 0509 — Merge-or-Kill Stale Branches: closure verification (recorded 2026-08-19)

**Item:** [0509] merge-or-kill stale branches (anonymous-search-429,
d1-restore-deflake v1/v2, checkout-session-auth v1/v2,
terminal-webhook-replay, codex/0509-browser-*) — each gets landed or deleted
with a dated note.

This note verifies the disposition recorded in
`docs/branch-cleanup-2026-08-18.md` against current `origin/main`
(`ae1b545b`, 2026-08-19). Every named branch was re-triaged against the
merged record; one item is corrected (netcup was marked "LANDED" on 08-18 but
its PR is still open).

## Verification table (as of 2026-08-19, against `origin/main`)

| Branch | 08-18 disposition | Verified status 2026-08-19 |
| --- | --- | --- |
| `fix/anonymous-search-429-rate-limit` | KILLED — already landed | Confirmed. No local/remote ref; retry/error path already in `main`. |
| `fix/d1-remote-restore-cancel-deflake` (v1) | KILLED — already merged | Confirmed. No ref; branch tip was ancestor of `main`. |
| `fix/d1-remote-restore-cancel-deflake-v2` | KILLED — already landed | Confirmed. No ref; `/proc`-identity de-flake already in `main`. |
| `fix/0509-checkout-session-auth-coverage` (v1/v2) | KILLED — already landed | Confirmed. No refs; identical test blob already in `main`. |
| `test/0509-terminal-webhook-replay-reclaim` | KILLED — already landed | Confirmed. No ref; replay-stays-duplicate proof already in `main`. |
| `codex/0509-browser-attribution` | KILLED — redundant subset | Confirmed. No ref; content preserved via the integration PR. |
| `codex/0509-browser-integration` | LANDED via PR #774 | **Confirmed landed.** `app/lib/browser-job-telemetry.server.ts` + migration `0076_browser_job_telemetry.sql` present in `origin/main`; tip `5bf3f7f6` is an ancestor of `main`. |
| `codex/0509-netcup-browser-v2` | LANDED via PR #775 | **Corrected — still OPEN.** Netcup content (`ops/netcup-browser/`) is NOT in `origin/main`; PR #775 head `dc094eb4` is not an ancestor of `main`. The PR is open and pending CI/merge, not yet landed. |

## Closure status

- The dated disposition note `docs/branch-cleanup-2026-08-18.md` is merged to
  `main` via PR #776 (`4a773ffb`).
- All "already-landed"/killed branches have no remaining local or remote refs.
- `codex/0509-browser-integration` is merged (PR #774).
- **Open item:** `codex/0509-netcup-browser-v2` is dispositioned to LAND but
  is still open as PR #775; it should be merged once its CI run is green. This
  note supersedes the premature "LANDED" wording in the 08-18 record.
