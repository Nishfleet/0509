# Lane evidence — claim/issue-3393 (unit pi-issue-0509-3393, 2026-09-13)

Issue: Nishfleet/0509#3393 — growth: submit the AlternativeTo listing.

## What this unit did

Re-entrant takeover: worktree existed (previous unit incarnations died at
StartLimitBurst, zero commits, zero salvage); branch `claim/issue-3393`
fast-forwarded to origin/main bd41132f7 (worktree HEAD was 21 commits stale).

Two submission attempts against alternativeto.net, both recorded per
acceptance #2:

1. Plain fetch: `https://alternativeto.net/` and `/signup/` → HTTP 403
   (Cloudflare) — the recorded 2026-09-11 wall, unchanged.
2. Real-browser retry: headless + headed (xvfb) Chromium, Playwright 1.63.0
   (repo's own pinned dep, no new machinery): homepage 200, signup form 200 at
   `/signup?returnTo=%2Fuser%2Fedit%2F` (no-trailing-slash variant), but the
   form's hCaptcha returns no token to this datacenter IP (checkbox clicked,
   challenge view opened, no silent pass, 25s+ waits, signup POST never
   fired). No solver/bypass used (no-workaround-hacks rule).

Result: sanctioned observe-to-close. Account NOT created (nothing half-made);
verification inbox prepared + verified (fivetonine@uberip.com, password
recorded in the artefact doc — disposable, not a repo secret).

## Docs changed (all additive)

- docs/alternativeto-listing-2026-08-11.md — fresh dated `blocked:` line, new
  "Submission attempt pass (2026-09-13, issue #3393)" section with both
  attempts + the line-start `receipt:` (deepest reached+verified URL).
- docs/listing-submissions.md — AlternativeTo row: fresh 403/identity cause,
  unblock step now points at the recorded inbox.
- docs/venue-submissions-status-2026-08-11.md — AlternativeTo row: fresh
  2026-09-13 re-verification appended (nothing silently stale).

## Proof

- tests/unit/listing-receipts.test.ts: 3/3 green (dot reporter), pre- AND
  post-change.
- Issue verify block: LEDGER_RECEIPT_OK; listing_HTTP=403 (the recorded wall,
  curl-confirmed); termination: ALTERNATIVETO_LISTED, exit 0.
- tests/lane-evidence-collision.test.ts: 2/2 green (this report is
  lane-unique).
- sgscan: run on the committed diff (see PR body for its exit).
