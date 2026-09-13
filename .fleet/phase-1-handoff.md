# Phase-1 handoff — issue 3322 (BET 1 cohort re-seed) — written by the manager 2026-09-13 ~17:00Z

You are the fresh phase-1 `worker` subagent. Your manager did the investigation; DO NOT
re-derive it. Your job: complete phase 1 **extremely well**. Read, in order:

1. `.fleet/plan-3322.md` — the plan. You are phase 1 ONLY.
2. `.fleet/phase-1-receipts.md` — the prior unit's receipts: what already works
   (signup via curl, D1 reads) and where it stalled (magic-link ticket
   redemption: the emailed link carries the real ticketId; the D1 row id is only
   the HMAC storage key — they replayed the storage id 3x and got
   `?error=callback_failed`).

## Manager receipts added since (code-read, 2026-09-13, verify them yourself in the code — do not trust)

- `workers/schedule.ts`: the three-hourly tick (`0 */3 * * *`, 15:00/18:00/21:00Z)
  carries `includeScans: true` + `includeDigests: true` but the digest cycle only
  enqueues a workspace while its LOCAL time is inside Monday 05:00–08:00
  (issue #2406). Today is SUNDAY — no weekly brief until Monday. The daily
  digest rail is `0 4 * * *` (digestCadence "daily", lookback 1d) — plan
  eligibility of a FREE workspace is still unresolved; that feeds phase 2/3.
- Manual `refresh-watchlist` route action is gated to `plan !== "free"`
  (`app/lib/watchlist-route-actions.server.ts:113-121`) — a free signup cannot
  self-serve a second scan; ONLY the scheduled 3-hourly tick can. Confirm.
- `/api/v1` = "Five to Nine Customer API": Bearer key, minted IN THE APP at
  `/app/developer-access`; read-only endpoints need plan Scout, write+account
  mutation need Starter/Agency (`app/routes/api.v1.ts:22-24`). Whether
  `watchlist.create` is read-group or write-group: check
  `app/lib/agent-action-catalog.ts` yourself.
- The competitors storage: NOT `watchlist_competitor` (probe: no such table) —
  find the real competitors-of-a-watchlist table name in
  `app/lib/data/watchlists-core.server.ts` / `app/lib/data/workspace-ops.server.ts`
  before writing any receipt that counts competitors.
- The prod survival state right now (manager read 2026-09-13 ~17:05Z):
  watchlist=1 row ("Launch readiness canary", created 2026-09-11, is_active=1,
  last_scanned_at=NULL as of 07:05Z), user=17, watch_event=0, digest_item=0,
  delivery_attempt=7 (4 lane='internal' as of 07:05Z — THREE new attempts since;
  determine their lanes: if the canary's deliveries are lane='internal' the
  #1451 guard (which samples lane='customer' ONLY) cannot see them — that is the
  reason the cohort must be a real customer-lane cohort), verification=58.

## Manager receipts added for THIS run (2026-09-13T14:04Z, fresh unit)

- Fresh read 14:04Z: watchlist=1, watchlist_run=1 (UNCHANGED since the 09-11
  creation), watch_event=0, digest_item=0, delivery_attempt=7, user=17. The
  3-hourly ticks at 09:00Z and 12:00Z today did NOT add a watchlist_run row:
  root-cause whether the tick doesn't run at all, or the scanner skips the
  canary watchlist (plan-feature-gate? is_active? lane? last_scanned_at NULL?)
  — that finding feeds phase 2.
- Next scheduled tick 15:00Z is past this unit's ~42-min wall — do NOT wait
  for it; root-cause from code + receipts.
- You are on branch claim/issue-3322 (pushed c947b0f3d, rebased on origin/main
  5c32a83c4). Commit here; your manager pushes. Never main, never git stash.
  Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-3322.
- Timebox: 15 minutes HARD for phase 1 (manager amendment; precedent 42-min
  unit). At 15 min: commit what works, write .fleet/phase-1-report.md (what
  works / what's blocked), end. NOT perfect — extremely well within the box.
- One heavy process at a time (unit MemoryMax=4G). No coverage, no typecheck.
- Prod D1 reads: `set -a; source ~/.config/cloudflare/deploy-ci.env; set +a;
  npx wrangler d1 execute 0509 --remote --json --command "..."`. Secrets never
  printed. All spend free-tier only.
- Return in your final message: the final cohort counts (accounts/watchlists/
  competitors), whether a tick scan was observed or root-caused, the receipts
  file diff-summary, and any blockers — plain sentences. EXTREMELY WELL, not
  perfect.

## Mission (phase 1, acceptance bullet 2)

Re-seed a watcher cohort of **at least 20 competitors** through the product's
own surface — the app, or the audited `/api/v1 watchlist.create` action —
NOT direct D1 inserts. Then prove the cohort is real and inspectable:

- the watchlist row(s) + its ≥20 competitors exist in prod D1 (via the
  surfaces' own audit trails — receipts must name the tables/rows you read),
- the account's plan + whether the 3-hourly tick can scan it (includeScans) —
  if a scheduled tick runs while you watch (check `date -u`; the next one may
  be outside your window), capture the watchlist_run/last_scanned_at evidence,
  else record that the observation belongs to the 72h follow-up.

The prior unit proved signup (302 `?sent=1`) but died at redemption. You have
TWO unit-feasible routes; try A, fall back to B:

- **A (preferred if it works): owner-captured auth state.** `.auth/0509-internal.json`
  (playwright storageState, owner-captured, gitignored) does NOT exist in this
  worktree (probe: ENOENT) — it lives in the primary 0509 checkout. Find it with
  TARGETED ls (NO home-wide find/recursive searches — spawn guard): try
  `/home/nish/0509/.auth/`, `/home/nish/0509/`, then `ls ~/.workspaces*`-level
  guesses. If found: COPY it into this worktree's `.auth/` (a copy, not a move;
  the original stays; never print its cookie values, never commit it — it is
  gitignored). Then either (a) replay its session cookie via curl against
  `https://0509.io/app` and drive the setup-checklist import (ONE authenticated
  POST: `intent=create-market-desk-import&competitors=<domain>&selectedRowIds=row-1`,
  `app/lib/setup-checklist-action.server.ts:113,146,338`; row ids `row-<n>`,
  `app/lib/competitor-import.ts:114` — READ those lines and use the EXACT
  documented formData shape), or (b) mint/locate an API key via
  `/app/developer-access` and use the audited `/api/v1` — whichever the code
  says is reachable with the internal account's plan. Evidence: the audit rows
  (`watchlist.create` is audited — show the audit trail).
- **B (if A blocks): a fresh signup + redemption** — repeat the prior unit's
  signup recipe (in the receipts) and complete redemption by ANY unit-feasible
  means you can find (e.g. if you discover the email lands somewhere
  unit-readable, say so with receipts). If you cannot redeem in 2 cycles, STOP
  and record exactly what blocked redemption — that is a finding, not a
  failure, provided the receipts say why.

Competitor domains: pick ≥20 REAL, publicly-fetchable, STABLE domains (the
detector counts `landing_page_cta_changed` — they must be real pages, prefer
well-known brands; the repo's own fixtures/canary configs show which domains
the fleet already treats as 0509's cohort — look at
`scripts/canary-cta-detector.mjs` / ops/canary configs / the launch-readiness
watchlist's own competitors — do NOT invent dead domains; last unit's bail
reasons were landing_http_error / landing_blocked / landing_challenge_page).

## Watchdogs (the 10-minute stall rule applies to YOU)

- HARD TIMEBOX: 25 minutes wall-clock. If the cohort is not complete by then,
  record what IS proven, write receipts, return. A partial+receipts phase 1 is
  a successful phase-1 exit for the manager to adjudicate.
- Do NOT: commit, push, close/comment on issues, edit app/ or workers/ code,
  run vitest/playwright/npm test (no test suites — this is evidence+production
  work), run typecheck/coverage, or print secrets (cloudflare token, cookie
  values). The manager commits and reviews.
- DO: append everything to `.fleet/phase-1-receipts.md` under a new dated
  `## 2026-09-13T~17:xxZ (this run)` heading — counts, table names, exact
  commands, exit statuses, failures verbatim. End your final message with
  `phase-1: <done|partial> — <one sentence>`.

## When you finish

Return: the final cohort counts (accounts/watchlists/competitors), whether a
tick scan was observed, the receipts file diff-summary, and any blockers — in
that order, plain sentences. EXTREMELY WELL, never perfect.
