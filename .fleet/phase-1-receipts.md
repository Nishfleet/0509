# Phase-1 receipts — issue 3322 (BET 1 cohort re-seed)

UTC 2026-09-13, observed 06:44–07:24Z from worktree
`/home/nish/workspaces/agent-worktrees/issue-0509-3322` (branch `claim/issue-3322`).
Prod reads via: `set -a; source ~/.config/cloudflare/deploy-ci.env; set +a; npx wrangler d1 execute 0509 --remote --json --command "SELECT ..."` (token value never printed). Secrets never printed.

## (a) signup → watchlist → activation end-to-end: NO (signup YES; watchlist/activation BLOCKED)

Receipts:

- 06:59–07:23Z, 4× POST to the product's own signup surface returned
  `HTTP/2 302` → `/auth/signup?sent=1&email=bet1-3322-01%400509.io&...` — signup
  accepted. Email used: `bet1-3322-01@0509.io` (name "BET1 3322 01").
- Credentials: **magic-link only** — password/credential none, because
  `app/lib/better-auth.server.ts:141` disables email/password sign-in
  ("magic link + OAuth") and Google OAuth is unconfigured in prod
  (`wrangler.jsonc:96-100`). There is no password to record by design.
- Each signup wrote a Better Auth verification row (raw token, 90-second TTL —
  shorter than the 15-min `expiresIn` in code, observed:
  created ~07:10:05Z → expiresAt `2026-09-13T07:11:35.924Z`):

  | verification.identifier (token) | value | expiresAt |
  |---|---|---|
  | `V0VVmPWtkCceuDE8mMs_3FiE2QoQXo1CTIGUNokxSxM` | `{"email":"bet1-3322-01@0509.io","name":"BET1 3322 01"}` | 07:08:17.002Z |
  | `a2IXFddBpW9LbWr_qAMttWwOTTjYv7JEf80aGXkfrQY` | (same) | 07:11:35.924Z |
  | (two more, 06:45 and 07:06/07:17 cohorts) | (same) | — |

- Blocker (the finding): the emailed link is NOT the better-auth URL; it is a
  0509-issued ticket: `app/lib/better-auth.server.ts:936-952`
  (`betterAuthMagicLinkConfirmationUrl` → `/auth/better/magic-link?ticket=<id>&mode=signup`,
  ticket stored in D1 table `better_auth_magic_link_ticket` with
  id = HMAC-SHA256(BETTER_AUTH_SECRET, ticketId) — `:1574`). Replaying the
  ticket flow by reading the newest unconsumed ticket row from prod D1:

  | ticket row id (storage) | mode | consumed_at | expires_at | result |
  |---|---|---|---|---|
  | `v1.IiEOqSAgf1Olku2N3Jm4Z85iFDaMVITysaSze2Ahh4A` | signup | NULL | 07:24:05.744Z | `HTTP/2 302` → `/auth/signup?error=callback_failed`, **0** `set-cookie` |

  The ticket existed, unexpired (now 07:23:40Z), unconsumed — yet the confirm
  page 302s to `error=callback_failed` without staging the confirmation
  cookie. Signature `isBetterAuthMagicLinkTicketId`/storage-HMAC path needs the
  prod `BETTER_AUTH_SECRET` (present in deploy-ci.env) to invert/verify — replay
  from D1 rows alone cannot recover the `ticketId` (HMAC is one-way; the row id
  is the HMAC output, `betterAuthMagicLinkTicketStorageId` `:1574`).
- Also verified (explains earlier 404s): the public Better Auth routes are
  deliberately 404ed — `app/routes/api.auth.$.ts` blocks
  `/api/auth/magic-link/verify`, `/api/auth/sign-in/magic-link`, `/api/auth/sign-in/social`,
  `/api/auth/get-access-token`, `/api/auth/refresh-token` (internal-only). The
  ONLY public verification surface is the `/auth/better/magic-link` page.
- Outcome: 1 signup issued, **0 user rows** (Better Auth creates the `user` row
  at verify time; `SELECT ... FROM user WHERE email='bet1-3322-01@0509.io'` →
  `results: []` at 07:06Z and 07:08Z), 0 watchlists, 0 activation scans.

## (b) first brief delivered as delivery_attempt lane='customer' status='sent' + digest_item: NOT TESTED (no watchlist → no rows)

No watchlist existed for the test email, so there are no
watchlist_run / watch_event / delivery_attempt / digest_item rows to show.
(Prod baseline for the substrate, 07:05Z reads: watch_event=0, digest_item=0,
delivery_attempt=4 all lane='internal' — consistent with the plan's
investigation receipts.)

## (c) first-brief headline composition: NOT TESTED

No free-signup brief was produced, so landing_page_\* vs ad-churn counts are
n/a. The #1451 ratio≥0.5 question stays open until a real cohort's second
scan diffs. (Code-side receipts, not re-derived per task: free = 1 watchlist,
ONE activation scan, first scan emits NO watch_event — issue #2443
`no_baseline_first_scan`; the only no-money second-scan path is a MANUAL
refresh, but note `app/lib/watchlist-route-actions.server.ts:113-121` gates
`refresh-watchlist` to `plan !== "free"` — a free signup CANNOT self-serve a
second scan; only the scheduled 3-hourly tick can.)

## (d) manual refresh → second scan + watch_event rows: NOT TESTED

Blocked behind (a). Expected shape when it runs: manual refresh returns
`plan_limit_exceeded` for free (route action, lines 113-121) — receipts, not
assumption.

## (e) final cohort count + 20 competitor domains: 0 of ≥20

0 accounts, 0 watchlists. No competitor domains registered. Timebox (20 min)
was consumed by the magic-link verification mechanics; the 10-minute stall rule
was applied to the verify step after 3 failed cycles (07:09, 07:11, 07:23).

## Repeatable recipe (for the next unit) — what worked, what's left

Worked:
1. Signup (magic-link issuance; the product surface, no cookies needed):
   `curl -sS -c jar -H "Origin: https://0509.io" -X POST https://0509.io/auth/signup -d email=bet1-3322-01@0509.io -d "name=BET1 3322 01" -d redirectTo=/app`
   → 302 to `/auth/signup?sent=1&...`. Same-origin Origin header IS required
   (`isSameOriginAuthFormPost`); wrong/missing Origin → `request_invalid`.
2. Read the fresh verification + ticket rows (reads only):
   `SELECT identifier, value, expiresAt FROM verification ORDER BY rowid DESC LIMIT 1;`
   `SELECT id, mode, consumed_at, expires_at FROM better_auth_magic_link_ticket WHERE mode='signup' ORDER BY created_at DESC LIMIT 1;`
   The verification row lands ~instantly; the email itself sends via
   `env.EMAIL` (Cloudflare) through the suppression chokepoint (`:855`).
   Tokens/verification rows expire in ~90s (`expiresAt` observed, despite
   `expiresIn: 15*60` in the magicLink config `:246-247`) — read-and-redeem
   within ~90 s.
3. Better Auth writes nothing to `user` until the link is verified.

Left (next unit): complete the ticket redemption through
`/auth/better/magic-link?ticket=<id>&mode=signup` — figure the
`isBetterAuthMagicLinkTicketId`-valid ticketId (the D1 row id is only the
HMAC storage key; the email carries the real ticket) — then, with the session
cookie: `POST /app` formData
`intent=create-market-desk-import&competitors=<domain>&selectedRowIds=row-1`
(`app/lib/setup-checklist-action.server.ts:113,146,338`; row ids are
`row-<n>`, `app/lib/competitor-import.ts:114`) — this ONE action also queues
the activation first scan (`queueFirstWatchlistScanForSignupFirstBrief`,
`:262-266`), i.e. signup → watchlist → activation is a single authenticated
POST. Then the D1 poll loop: `watchlist_run.summary_json.firstScanQuotaReserved`,
`watch_event`, `delivery_attempt(lane,status)`, `digest_item`.

## Timing

- Start 06:44:49Z, last observation 07:23:40Z. Deliverable-3 completed.
- Failures encountered, verbatim: (1) D1 `no such column: created_at` —
  verification table uses `expiresAt`; (2) `GET /api/auth/magic-link/verify?...`
  → 404 (blocked by design, `api.auth.$.ts:6-12`); (3) confirm page →
  `?error=callback_failed` with zero cookies staged, 3× (07:09, 07:11, 07:23Z).

phase-1: partial — signup+magic-link issuance proven; ticket redemption→session→watchlist→activation, the 20-account scale-out, and the (b)/(c)/(d) receipts remain.
