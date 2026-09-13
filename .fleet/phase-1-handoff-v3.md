# Phase-1 completion handoff — issue 3322, unit-3 (2026-09-13, after 17:56Z)

You are the fresh phase-1 worker. Worktree: `/home/nish/workspaces/agent-worktrees/issue-0509-3322`,
branch `claim/issue-3322` (already rebased onto origin/main; do NOT rebase, do NOT push, do NOT open a PR, do NOT comment on issues, do NOT add labels).

Read first (authoritative trail, ~5 min):
- `.fleet/plan-3322.md` — the manager plan (phases, amendments, risks). You are phase 1 ONLY.
- `.fleet/phase-1-receipts.md` — two prior attempts: (07:00Z) 1 signup, 0 redeemed; (17:00Z) burst 20/20 signups, 0/20 redeemed — every confirm 302s `?error=callback_failed` with 0 set-cookie.

## Your scope — phase 1: redemption root-cause + cohort >= 20 (HARD BOX: 20 minutes from your start)

1. Root-cause the confirm failure. `app/routes/auth.better.magic-link.tsx` has FOUR
   `callback_failed` exits: lines 64, 112, 144, 185. Prior receipts: the redirect went to
   `/auth/signup?error=callback_failed` (mode=signup; that excludes any 185/fallbackMode→signin
   outcome) with ZERO staged cookies and the D1 ticket row unconsumed + unexpired
   (expires_at 15-min TTL, not the 90s verification TTL). Decide with receipts: is this
   pacing/TTL (mechanical — your fix), or a product code bug (record file:line + which exit +
   why; a code fix belongs to the NEXT worker, not you — this phase's diff stays receipts-only
   per the plan's 16:10Z amendment)? One decisive discriminator: ONE fresh signup redeemed
   within ~30 s of issuance. If that still fails, it is NOT TTL.
2. Land the cohort: >= 20 competitor accounts WITH watchlists through the product's own
   surface ONLY — signup POST → ticket redemption → authenticated
   `POST /app` formData `intent=create-market-desk-import&competitors=<domain>&selectedRowIds=row-1`
   (`app/lib/setup-checklist-action.server.ts:113,146,338`; this ONE call also queues the
   activation first scan, `:262-266`). NO direct D1 inserts. You may edit and re-run
   `.fleet/burst-3322.sh` (it exists and mechanically works; 17:00Z failure = confirm stage).
   Competitor domains: real, spread, food/project-SaaS style; the 20 become the guards'
   permanent population — no disposable fixtures.
3. Prod-D1 receipts (token: source `~/.config/cloudflare/deploy-ci.env` in your shell; NEVER
   print the token; `npx wrangler d1 execute 0509 --remote --json`; extractor: skip to the
   first `[` — the wrangler WARNING banner breaks naive json.load):
   users +20, watchlist +20 (is_active=1), watchlist_run > 0 OR the queued-activation receipts
   (`watchlist_run.summary_json.firstScanQuotaReserved` / last_scanned_at — whichever the
   mechanism actually writes), `cta_pipeline_stage_counts` + `cta_pipeline_bail_reason_counts`
   deltas for today (the accept-1 telemetry), `delivery_attempt` lane='customer' and
   `digest_item` counts. If the first brief / first scan needs the next 3-hourly tick or the
   04:00Z rail, record the exact expected timing instead of waiting past the box.
4. Both guards, read-only, AFTER sourcing the env (prior lesson: unsourced → both exit=2):
   `node scripts/canary-cta-detector.mjs --json` and `node scripts/canary-digest-headline-ratio.mjs`.
   Record their printed measurements verbatim. If your cohort's activation produced
   landing_page_cta_changed events / customer-lane delivered items, this IS the non-vacuous
   pass — capture it.
5. APPEND a new section `## 2026-09-13T<HH:MM>Z (unit-3)` to `.fleet/phase-1-receipts.md`:
   what you ran, verbatim failures, counts, the discriminator verdict (TTL vs code), and the
   exact left-overs. Allowed writes: `.fleet/phase-1-receipts.md`, `.fleet/burst-3322.sh`
   (if edited: leave a dated backup sibling `.fleet/burst-3322.sh.pre-<why>-<UTCts>`),
   `bet1jar.txt` (regenerated). NOTHING else; NO new files outside `.fleet/`.
6. COMMIT on `claim/issue-3322`: message `wip(3322): phase-1 — <one line>`; NO trailers, NO
   "Generated with", NO Co-Authored-By (agent names are forbidden).

## Hard constraints

- 4G MemoryMax unit: NO `npm test`, NO vitest, NO coverage, NO typecheck (CI owns them).
  One heavy process at a time. No second test suite in parallel.
- 10-minute stall rule: anything blocked > 10 min — record it in the receipts section and move on.
- The 72h observe (accept-3) is NOT yours. The guard provision + drill (accept-4) is NOT yours.
  If you finish early AND the box allows, you may note (not execute) what phase 2+3 need.

Finish with: `## Completed`, `## Files Changed`, `## Notes` — the manager folds your final
message into the phase-2 handoff.
