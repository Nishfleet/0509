## What changed

The capture-validity gate (BET 4) turned "if we send it, the page really changed" into the product's strongest promise — but a `capture_failed` row was only visible through the Agency `/api/v1/watchlists/:id/runs/latest` endpoint. A Scout or Starter customer who got zero alerts had no way to tell a quiet week (we checked, found nothing) from a silently failing week.

This ships the missing signed-in surface: a URL-addressable run-history page per competitor.

- **New route** `app/routes/app.watchlists.$watchlistId.tsx` — `/app/watchlists/:id` renders the latest monitoring run and lists every capture attempt: target URL, status (`Captured` / `Check failed` / `Skipped`), checked-at time, and for failed/skipped captures the human reason label. Internal `landing_*` / `skipped_due_to_*` / public reason-code tokens never leave the server; only the human label from `formatCaptureAttemptReasonLabel` is shipped to the client. It is read-only (no live scraping) and gated only by a normal signed-in workspace session — no Agency plan, no customer API key.
- **Doorway** in `app/components/watchlists/recent-checks-section.tsx` — the "Full run history" link opens the new page for the selected competitor. The quiet-line copy no longer prints the raw reason-code token either.
- **Registration** in `app/routes.ts` under the watchlists route, page styles in `app/app.css`.
- **Seed** `J3ReplayAction` `run_history` in `app/routes/api.e2e.j3.replay.ts` — deterministically creates one succeeded + one `capture_failed` capture (internal code `landing_challenge_page` → public `cloudflare_challenge`) inside a single latest run for a dedicated `e2e-watchlist-j3-runhistory` watchlist. No live scraping, idempotent on retry.
- **Proof** `tests/e2e/watchlist-run-history.spec.ts` + a `workspace` Playwright project in `playwright.config.ts`.

Honest copy: the page states a failed check is never an alert but never hidden, and a quiet week is provable.

## Verification

Ran on the rebased branch (base `origin/main` @ `3c9b7a4f`):

- `npx tsc -b` — exit 0.
- `/home/nish/.local/bin/sgscan <changed files>` — "No new security findings", exit 0.
- `npx vitest run --project node tests/capture-attempt-reason-code.test.ts tests/e2e-j3-replay.route.test.ts` — 30 passed.
- `npx vitest run --project workers tests/integration/watchlist-run-capture-attempts.integration.test.ts` — 5 passed.
- The issue's verify command (exact):
  `E2E_START_LOCAL_SERVER=1 npx playwright test --config=playwright.config.ts --project=workspace`
  `✓ run history lists the failed capture with its human label and no raw token (1.7s)`
  `1 passed` — exit 0.

run-proof: playwright project=workspace, `tests/e2e/watchlist-run-history.spec.ts` passed (1/1, exit 0) on local fixture DB seeded via the J3 replay endpoint, asserting the human label "Anti-bot challenge wall" renders and the tokens `cloudflare_challenge` / `landing_challenge_page` do not.

net-positive-because: this is a feature issue — the new page consumes data the capture-validity gate already records (`proof_capture` rows, `listCaptureAttemptsForRun`), with no new data store, no new organ, no migration, and no schema change. The net is a user-visible trust surface replacing a private telemetry-only failure state.

Closes #1476
