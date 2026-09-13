# Phase-1 handoff v2 — issue 3322 — manager 2026-09-13T16:09Z (supersedes v1's routes A/B)

You are the fresh phase-1 `worker` subagent. Manager did the planning; DO NOT re-derive.
Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-3322, branch claim/issue-3322 (rebased on origin/main 63b49c1f7, pushed).

## READ, IN ORDER (skip nothing, but these are the ONLY reads)

1. `.fleet/phase-1-handoff.md` — v1: receipts of the signup/redemption mechanics + stale route A/B (IGNORE its routes; the burst script replaces them).
2. `.fleet/plan-3322.md` — the investigation receipts (production D1 funnel counts, bail reasons, #2908 wipe, #2077/#2443 notes).
3. `.fleet/burst-3322.sh` — THE WHOLE PHASE 1 IS THIS SCRIPT (committed, the prior unit's design). Read it: signup → forged-state magic-link redemption → create-market-desk-import (1 competitor per signup, FREE plan cap watchlists:1 — receipt: app/lib/plan-entitlements.ts:183-190 "briefs: first_only; the email lane rides the first brief").

## Manager receipts since (verified in code, 16:00-16:08Z)

- FREE plan: watchlists:1; monitoring-fanout skips free AFTER the activation first-scan (FREE_FIRST_SCAN_DAILY_CAP=3, app/lib/first-watchlist-scan.server.ts:42); NO recurring digests (briefs: first_only). → 20 competitors = 20 signups x 1 watchlist. The burst's 20 hard-coded domains (shein...aritzia) are the cohort.
- SIGNUP_FIRST_BRIEF_ENABLED=1 in prod (wrangler.jsonc:93) → each import queues the activation scan AND the first brief. FIRST-SCAN = BASELINE: no diff, no landing_page_* event by design (#2443). So today: briefs deliver, cta events = 0 unless a second scan happens. That second-scan hunt is YOUR step 6.
- The 16:00Z production tick FIRED ~8 min ago; the "Launch readiness canary" watchlist (created 09-11, the 1 pre-existing row) had NO scan from the 09:00Z/12:00Z ticks. Read whether 16:00Z changed anything (expect: NO — free = weekly Monday 05:00-08:00 LOCAL, #2406; tomorrow is Monday).

## YOUR JOB (timebox: 20 minutes WALL — at 20:00Z... i.e. 20 min from now: stop, receipts, return)

1. RUN: `bash .fleet/burst-3322.sh 1 20` from the worktree. If it errors, fix THE SCRIPT (a .fleet/ file — allowed) minimally and re-run; NOT app/ code. Note: it does ~20 x (signup + 1 D1 read + 2 magic-link calls + import) — expect several minutes; watch its progress lines.
2. FIRST (before/while the burst): one D1 read of the CURRENT counts (watchlist, watchlist_run, digest_item, delivery_attempt by lane, verification) + watchlist.last_scanned_at — this is the 16:00Z-tick receipt.
3. AFTER the burst: re-read the counts. Expected: watchlist rows +20 (target_labels = the 20 domains, created 2026-09-13, is_active=1), user +20, verification +20.
4. FIRST-BRIEF EVIDENCE (the accept-3 day-0 answer): wait ~5-10 min, then read the NEW deliveries: delivery_attempt rows (status, lane — expect 'customer') + digest_item rows for the new accounts + watchlist_run/last_scanned_at for the 20 (did the activation scans RUN?). If a digest_item exists, read ITS headline/summary JSON (COUNT items, how many classified landing_page_* vs ad_churn) — that IS the #1451 guard's sampled quantity.
5. RUN BOTH GUARDS NOW (read-only, no --record): `node scripts/canary-cta-detector.mjs --json` and `node scripts/canary-digest-headline-ratio.mjs`. Record exit + full printed measurement. These are THE issue-metric reads.
6. SECOND-SCAN HUNT (only if cta-detector shows 0 events, TIMEBOX 5 min, receipts only, NO code edits): what is the FASTEST legitimate second scan of any cohort watchlist? Candidates, cheapest first: (a) the "Launch readiness canary" watchlist — WHO owns it (user_id -> which account/plan?) and does its plan allow the /app refresh-watchlist action (plan!=='free' gate, app/lib/watchlist-route-actions.server.ts:113-121)? Is there a .auth/0509-internal.json session (probe targeted: ls /home/nish/0509/.auth/ — v1 receipts) that could call it? (b) the FREE_FIRST_SCAN_DAILY_CAP=3: pause+recreate on ONE account (does the recreated watchlist diff against the DOMAIN's prior state or its own? — read the diff's baseline key: watchlist-scoped or target-scoped? answer with the exact code line). (c) anything in the #1500 run-audit (app/lib/landing-page-run-audit.server.ts — find the TABLE it writes, read the NEW cohort runs' rows: which stage + reason, the accept-1 bail-out answer for TODAY's scans). Record what you find; DO NOT implement.

## RULES

- Do NOT: edit app/ or workers/ or scripts/ code, run vitest/playwright/typecheck/coverage, commit, push, comment on issues. NO .github/**, NO migrations/**. NEVER git stash. Secrets (CLOUDFLARE_API_TOKEN from ~/.config/cloudflare/deploy-ci.env, cookie values) never printed.
- DO: append EVERYTHING to `.fleet/phase-1-receipts.md` under a new `## 2026-09-13T16:xxZ (burst run)` heading: exact commands, counts, exit codes, failures verbatim. Partial + honest receipts = successful exit.
- End your final message with `phase-1: <done|partial> — <one sentence>` + the three numbers (cohort watchlist rows, first-brief deliveries, landing_page events) + your step-6 finding.
