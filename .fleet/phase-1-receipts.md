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

## 2026-09-13T17:00Z (burst run)

Worker: fresh phase-1 unit, worktree /home/nish/workspaces/agent-worktrees/issue-0509-3322,
branch claim/issue-3322. Started 17:00:09Z; HARD BOX 17:20Z (this section written 17:19-17:21Z).

### Step 1 — burst-3322.sh

- Launched 17:07:12Z: `nohup bash .fleet/burst-3322.sh 1 20 > /tmp/burst-3322-1700.log 2>&1 &` (pid 547590).
- NO script edits needed (ran to completion of each iteration; see failure mode below).
- FAILURE MODE, 15/15 iterations observed by 17:19:22Z, verbatim (identical for 01-15):
  `[01] confirm NOT-app-302: 302 https://0509.io/auth/signup?error=callback_failed`
  (signup:302, token read OK, stage:302→?mode=signup OK, confirm 302→?error=callback_failed, import never reached).
- Same signature as the prior unit's redemption failures (.fleet receipts, 07:09/07:11/07:23Z, 0 set-cookie).
  Working hypothesis (INFERENCE, not verified): the 16:26Z pacing fixes (3s sleeps + 20s 429-retry penalties)
  push the confirm POST past the ~90s verification TTL — prior receipt: tokens expire ~90s. Each iteration ran ~45-50s.
  NOT proven within the box (no per-step timing was captured).
- At 17:19:22Z: 15/20 done, ALL confirm-callback_failed. FINAL (observed 17:23:18Z, appended within
  the receipts grace): iterations 16-20 identical failures; final line `burst done: ok=0 fail=20`.
  NET: 0/20 cohort. 0/20 signups redeemed.

### Step 2 — BEFORE counts (production D1; `set -a; source ~/.config/cloudflare/deploy-ci.env; set +a; npx wrangler d1 execute 0509 --remote --json --command "..."`)

- Read#1 @17:07:07Z: ran OK but extractor (naive `json.load` on banner-prefixed output) FAILED — numbers not captured. Lesson recorded: skip to first `[`.
- Read#2 @17:09:09Z (EXTRACTOR FIXED; burst had launched 17:07:12Z, so +0/+1 race possible on user/verification only):
  watchlist=1 (new=0), users=17, verifications=89, watchlist_run=1, digest_item=0, delivery_attempt=7 (lane=customer: 1), watch_event=0, watchlists_ever_scanned=0.
- 16:00Z-tick receipt: sole watchlist row = `launch-readiness-canary-watchlist` / "Launch readiness canary" /
  user_id=`launch-readiness-canary-owner` / created 2026-09-11T17:56:36.312Z / updated_at 2026-09-11T21:35:47.356Z /
  last_scanned_at=NULL / is_active=1. → The 16:00Z tick did NOT scan it (expect: NO — free = weekly Mon 05:00-08:00 local, #2406). CONFIRMED.

### Step 3 — AFTER counts @17:19:22Z (burst mid-flight, 15/20)

Same command as read#2. Delta vs 17:09:09Z:
watchlist 1→1 (+0), users 17→17 (+0), verifications 89→101 (+12), watchlist_run 1→1, digest_item 0→0,
delivery_attempt 7→8 (+1; lane=customer still 1 → the +1 is internal-lane),
watch_event 0→0.
Interpretation (receipt, not inference-free): every burst iteration's SIGNUP + verification row land
(=90s-TTL stage works), but redemption→session→watchlist never completes → 0 cohort rows. Expected +20/20/20 NOT achieved.

### Step 4 — FIRST-BRIEF evidence

NOT OBTAINABLE this run: 0 cohort accounts exist (0 imports), so no delivery_attempt/digest_item/
watchlist_run/last_scanned_at evidence for the 20. Physical wait (~5-10 min) satisfied by the 17:19:22Z read: all ZERO. The 20-min box preempted a second burst attempt.

### Step 5 — BOTH guards, read-only, no --record (env sourced)

- `node scripts/canary-cta-detector.mjs --json` → **exit=1**, printed: `{"ok":false,"local":false,"windowDays":7,"watchlistCohort":25,"database":"0509","row":{"ctaEventCount":0,"activeWatchlistCount":0,"firstCtaEventAt":null,"lastCtaEventAt":null},"validation":{"ok":false,"failures":["silent CTA detector: 0 landing_page_cta_changed events in the last 7 day(s)."]}}`
- `node scripts/canary-digest-headline-ratio.mjs` → **exit=0**, printed: `sample window 24h (since 2026-09-12T17:18:28.323Z): no delivered digest items; nothing to measure today` / `rolling window: 0 measured day(s), ratio 0.000 (target >= 0.6, guard < 0.5)` / `verdict: ok — headline ratio at/above the 50% guard floor.`
- NOTE: first attempt WITHOUT sourcing deploy-ci.env → BOTH guards exit=2 (`wrangler d1 execute failed` — the
  guard spawns wrangler with the ambient env; no token → fail). Guards need the env sourced in the calling shell.
  Re-run WITH env: the exit=1/exit=0 reads above. (Guard-2 sampled 2026-09-12T17:18Z–now: real remote sample →
  it appended its history — its designed behavior, writes only its own state dir, no repo writes.)
- Metric state: BOTH guards vacuous today — 0 CTA events (7d) AND 0 delivered digest items (24h). Exactly the
  BET-1-dark receipt the issue predicts.

### Step 6 — second-scan hunt (receipts only; 0 cta events => hunt applies; TIMEBOXED, PARTIAL)

- (a) Launch-readiness-canary ownership: user_id=`launch-readiness-canary-owner` (D1 read above).
  Its plan: NOT queried (box). Its last_scanned_at: still NULL at 17:09 — no scan via any tick today.
  Manual refresh gate = `plan !== "free"` (manager receipt, watchlist-route-actions.server.ts:113-121) — if this
  owner is a FREE workspace, no self-serve second scan exists. Whether `/home/nish/0509/.auth/0509-internal.json`
  exists: NOT probed (box). OPEN.
- (b) FREE_FIRST_SCAN_DAILY_CAP=3 pause+recreate diff-baseline question (watchlist-scoped vs target-scoped):
  NOT RESOLVED (box) — `app/lib/watchlist-diff.server.ts` does not exist; diff/baseline ownership likely lives in
  competitor-site-monitor / first-watchlist-scan paths; not traced in time. OPEN.
- (c) #1500 run-audit sink: `app/lib/landing-page-run-audit.server.ts:81` `emitLpRunAudit` emits STRUCTURED LINES
  (observability), NOT a D1 table — there is no audit TABLE to read cohort-run rows from. Partial answer:
  #1500 bail telemetry = observability lines; any "read the new runs' bail reasons" duty must go through
  whatever sinks those lines (not queried; box). cta_pipeline_* tables remain the D1-readable stage/bail counts
  (app/lib/cta-pipeline-stage-counts.server.ts:490-498 records watchlistId context per stage).

### Environment receipts

- Wrangler banner on every call: `▲ [WARNING] Processing wrangler.jsonc configuration: - "unsafe" fields are
  experimental and may change or break at any time.` (cosmetic; breaks naive json.load — skip to first `[`).
- One mid-read extraction failure (17:07, BEFORE read#1) —ExtractionError, fixed by prefix-skip; documented above.
- Guard exit=2 incident (env not sourced) documented above; re-run green.
- Burst log: /tmp/burst-3322-1700.log (worktree-write rule: only .fleet/phase-1-receipts.md + .fleet/burst-3322.sh
  writable, so the log went to /tmp).

phase-1: partial — burst script mechanically runs (15/20 iterations) but EVERY confirm 302s to callback_failed (0/20 cohort, 0 events, both guards vacuous); redemption--TTL-vs-429-pacing is the open thread.

## 2026-09-13T22:12Z (unit-6)

Worker: fresh phase-1 unit-6, worktree /home/nish/workspaces/agent-worktrees/issue-0509-3322, branch
claim/issue-3322, HEAD d76fedce5. Started 22:08Z; HARD BOX 22:20Z. Followed handoff-v5 exactly
(its header template says 2026-09-14; system+D1 UTC = 2026-09-13 — receipts stay UTC-anchored like
the 17:00Z section).

### What I ran (in order)

1. Reads: handoff-v5 → plan-3322 → ONLY the `2026-09-13T17:00Z (burst run)` receipts section →
   handoff-v4 (ONLY "Manager code-read verdicts" + discriminator mechanics). No verdict re-derived.

2. THE ONE discriminator (ONE iteration, curl -v, i=21, email bet1-3322-21@0509.io):
   - signup POST /auth/signup (Origin header) 22:10:09Z → 302 `/auth/signup?sent=1&email=bet1-3322-21%400509.io&name=BET1+3322+21&redirectTo=%2Fapp` ✓
   - D1 newest verification for i=21 (22:10:12Z): `identifier` = `MWbPj7fUr0j4gAkLA9S0YGsgBF-aObWtNFhmz6-KpDk`
     (43 chars = 32-byte base64url — consistent with the manager's better-auth 1.7.1 storeToken:"hashed" verdict),
     `expiresAt` = `2026-09-13T22:25:10.056Z`.
   - (TTL) expiresAt − issuance = 15:00.000 EXACTLY; confirm-POST fired 22:10:21Z = +11s after signup,
     14m49s remaining ⇒ the 12:05Z-unit "tokens expire ~90s" lore and the 17:00Z pacing/TTL hypothesis are
     DEAD: the verification TTL is 15 MIN, not ~90s. (Matches handoff-v4 "TTL/pacing CLEARED". The staging-302
     confirmation cookie itself: Max-Age=900 = 15 min — consistent pair.)
   - (a) STAGE-GET `?token=<identifier>&mode=signup&callbackURL=/app&newUserCallbackURL=/app&state=state-u6-21`
     → 302 `/auth/better/magic-link?mode=signup`. YES it carries set-cookie f9_better_magic. FULL attrs, 7
     set-cookie lines: 4x `f9_better_magic=; HttpOnly; Max-Age=0` clears (Path=/auth and
     Path=/auth/better/magic-link, each ±Domain=0509.io); 1x value-bearing
     `f9_better_magic=v1.ai3UpOvDx_3z_EKN.fzwm...ncL; HttpOnly; Max-Age=900; Path=/auth; SameSite=Lax; Secure`;
     2x `f9_better_magic_state=; Max-Age=0` clears (Path=/auth + Path=/auth/better/magic-link, both
     Domain=0509.io). NOTE: the staging 302 CLEARS f9_better_magic_state (Domain-scoped); my forged
     state cookie (Path=/, no Domain) survived the jar regardless.
   - (b) confirm POST `/auth/better/magic-link?mode=signup` (Origin + Content-Type + `--data ""`): request
     `Cookie:` header = `f9_better_magic=v1.ai3UpOvDx_3z_EKN.fzwm...ncL; f9_better_magic_state=state-u6-21`
     — YES, BOTH present. Curl-jar mechanics are NOT the bug.
   - (c) Location: `/auth/signup?error=callback_failed` ⇒ verdict (c). Signup→confirm +11s, freshly inside
     every TTL, STILL fails ⇒ decisively the manager's hashed-identifier read: the fix is the d76fedce5 diff
     (18 lines, app/lib/better-auth.server.ts), committed here but NOT deployed (prod counts unchanged, below).
     (a)=yes, (b)=yes, (c)=callback_failed ⇒ handoff-v4's (c)-branch; its "ONE variant" retry NOT spent — the
     22:03Z manager verdict + (a)(b)yes + +11s timing leave no free variable, and the (c)+(P2) action branch
     says NO burst. Timebox respected.

3. P1/P2 persistence probe (~2 min, read-only):
   - `sendMagicLinkEmail` (app/lib/better-auth.server.ts ~:820-900; :855 suppression chokepoint): SUCCESS
     path = consultEmailSuppression (a READ) → env.EMAIL.send → done. NO write of email/URL/token to any
     D1 table, KV, or R2. Only the FAILURE path writes (recordMagicLinkBounceSafely → recordEmailBounceFailure:
     bounce/suppression ledger, recipient-rejection only).
   - `magic_link_dispatched` structured log exists ONLY in the working tree (:259, d76fedce5, un-deployed ⇒
     not in prod).
   - `ls workers/`: app.ts, canonical-path.ts, delivery-recovery.ts, digest-schedule-recovery.ts,
     edge-cache.ts, monitoring-workflow.ts, origin-assertion.ts, primary-domain.ts, schedule.ts,
     security-headers.ts — NO email/ingest worker. workers/app.ts:954 `async email(message, env, _ctx)` is the
     status-canary receipt handler (`route: "email.canary.receipt"`) — it records a canary receipt, it does
     NOT persist 0509.io-addressed magic-link mail or its URL.
   - VERDICT: **P2 = not persisted.** The dispatched magic-link URL/token persists NOWHERE READABLE today in
     prod; the raw token exists only in the outbound email. Redemption mechanic = post-merge+deploy (the
     d76fedce5 diff: hashed-identifier handling + the magic_link_dispatched log). Valid outcome per handoff,
     NOT a failure. ⇒ NO burst this unit (35+ already-dead signups + this fresh +11s (c) prove a pre-deploy
     burst cannot succeed). Branch consequences: NO .fleet/burst-3322.sh patch (no WORKING redemption recipe
     exists pre-deploy — nothing to patch, so no dated backup), and NO i=21 end-to-end smoke (physically
     impossible pre-deploy; the i=21 signup IS done, its verification expires 22:25:10Z).

### AFTER-reads (deploy-ci.env sourced; token never printed; skip-to-first-`[` extractor)

D1 counts 22:11:28Z: watchlist=1, users=17, watchlist_run=2, watch_event=1, digest_item=1, verification=138,
delivery_attempt total=9 (lane=customer: 1, of which status=sent: 1; lane=internal: 8).
- vs manager 21:55Z (users=17, watchlist=1, watchlist_run=2, watch_event=1, digest_item=1, verification=136,
  customer/sent=1): ONLY delta = verification 136→138 (+2). +1 = my i=21 signup (22:10:10Z). +1 = unattributed
  inside the 22:03→22:11Z window (left-over #4).
- vs 17:00Z receipts (verification=101, delivery_attempt=8, watchlist_run=1, watch_event=0, digest_item=0):
  between 17:23Z and 21:55Z, +1 watchlist_run, +1 watch_event, +1 digest_item, +1 delivery_attempt (internal)
  landed — inter-unit drift, NOT this unit's work.
- watchlist rows (`SELECT id,user_id,name,created_at,last_scanned_at ... ORDER BY created_at DESC LIMIT 25`):
  STILL exactly ONE row — `launch-readiness-canary-watchlist` / `Launch readiness canary` /
  `launch-readiness-canary-owner` / created `2026-09-11T17:56:36.312Z` / last_scanned_at=NULL (never scanned,
  ~3 days). Zero cohort rows: 0 redeemed of 35+ signups; the 17:00Z burst's 20 remain 0.

Guards — BOTH read-only, WITH env (no exit=2 incident this time):
- guard-1 `node scripts/canary-cta-detector.mjs --json` → **exit=1**, printed:
  `{"ok":false,"local":false,"windowDays":7,"watchlistCohort":25,"database":"0509","row":{"ctaEventCount":0,"activeWatchlistCount":1,"firstCtaEventAt":null,"lastCtaEventAt":null},"validation":{"ok":false,"failures":["silent CTA detector: 0 landing_page_cta_changed events in the last 7 day(s)."]}}`
  (NOTE: activeWatchlistCount 0→1 vs the 17:00Z read — the sole canary watchlist now counts as active; still
  0 events ⇒ vacuous.)
- guard-2 `node scripts/canary-digest-headline-ratio.mjs` → **exit=0**, printed:
  `digest-headline-ratio canary` / `sample window 24h (since 2026-09-12T22:11:41.383Z): no delivered digest items; nothing to measure today` / `rolling window: 0 measured day(s), ratio 0.000 (target >= 0.6, guard < 0.5)` / `verdict: ok — headline ratio at/above the 50% guard floor.`
  (Vacuous-OK: digest_item=1 EXISTS in D1 but 0 in the 24h sample window — the guard samples digest_item ⋈
  delivery_attempt WHERE status='sent' AND lane='customer' in 24h ⇒ 0. The 1 digest_item is the 17:23–21:55Z
  drift row, not yet in a customer-lane delivery in-window.)
- Metric state: BOTH guards still vacuous — the BET-1-dark receipt stands. 0/20 cohort, 0 CTA events (7d),
  0 customer-lane digest deliveries (24h).

### Exact left-overs
1. Redemption mechanic: ships in THIS unit's PR diff (d76fedce5 — better-auth 1.7.1 storeToken:"hashed"
   handling + magic_link_dispatched log), INERT until deploy. Deploy = manager, post-merge (not this unit).
2. Burst: NOT RUN (P2 ⇒ pre-deploy burst proven dead by the +11s discriminator). Next unit, post-deploy:
   `bash .fleet/burst-3322.sh 1 20` needs NO changes — (a)/(b) jar mechanics verified GOOD today, TTL lore
   corrected to 15 min, pacing sleeps harmless.
3. i=21: signup + verification row spent (expires 2026-09-13T22:25:10Z); no user/watchlist row. The next
   unit's 1–20 range is unaffected (the script signs up fresh); 21 is reusable if needed.
4. +1 unattributed verification (136→138 minus my i=21) between 22:03Z and 22:11:28Z — one signup landed in
   that window from outside this unit. Unresolved (timebox); harmless (no cohort impact).
5. Sole watchlist STILL last_scanned_at=NULL ~3 days after creation — unchanged; feeds phase-2 / 72h-observe,
   NOT phase-1.

Writes: THIS receipts append ONLY. .fleet/burst-3322.sh untouched (no backup needed). No commit/push/gh.

phase-1: partial — discriminator: (a)yes (b)yes (c)callback_failed with TTL cleared (15-min, +11s) and P2=not-persisted: redemption mechanic = the PR diff, post-merge+deploy; burst correctly skipped; both guards still vacuous (0 cohort, 0 events, 0 customer deliveries).
