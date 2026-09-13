# Phase-1 handoff v5 — issue 3322, unit-6 (2026-09-14, written 22:03Z by the manager)

You are the fresh phase-1 worker, unit-6. Worktree:
`/home/nish/workspaces/agent-worktrees/issue-0509-3322`, branch `claim/issue-3322`.
HARD BOX: 12 minutes from your start. Receipts-append ONLY (see writes). No commit/push/PR/comment/label — the manager commits.

Read first (~3 min, in this order):
1. `.fleet/plan-3322.md` — manager plan. Your scope = phase 1 ONLY.
2. `.fleet/phase-1-receipts.md` — skim ONLY the `## 2026-09-13T17:00Z (burst run)` section: 20/20 signups, 0/20 redeemed, every confirm 302→`?error=callback_failed`. Your section header: `## 2026-09-14T<HH:MM>Z (unit-6)`.
3. `.fleet/phase-1-handoff-v4.md` — ONLY its "Manager code-read verdicts" + "discriminator" mechanics (steps 1-4, curl -v). Its TTL/pacing hypothesis is superseded below.

## Manager verdicts 22:03Z (do NOT re-derive; you have 12 minutes)

- Live production counts 21:55Z: users=17, watchlists=1 (canary), watchlist_run=2, watch_event=1, digest_item=1, delivery_attempt lane=customer/sent=1, verifications=136. Thirty-five extra signups since 17:09Z, still 0 redeemed. DO NOT burst until ONE account redeems end-to-end.
- Root cause, proven by the diff on this branch (commit d76fedce5, 18 lines in
  `app/lib/better-auth.server.ts`, NOT yet deployed): better-auth 1.7.1 with
  `storeToken: "hashed"` stores the verification token HASHED, so the D1
  `verification.identifier` the burst has been redeeming is the HASH, not the
  raw token — hence 0/20 `callback_failed`. The raw token exists only in the
  outbound email and (once deployed) in the new `magic_link_dispatched`
  structured log line. This diff ships in THIS unit's PR; it is inert in prod
  until deploy. Do NOT deploy, do NOT tail-attach waiting for it.
- THE question your 2-minute probe answers: does the dispatched URL persist
  anywhere READABLE today? Read `sendMagicLinkEmail` in
  `app/lib/better-auth.server.ts` (~:820-900, the :855 suppression chokepoint):
  does it write the email/URL/token to any D1 table, KV, or R2? Also
  `ls workers/` and grep for an email/ingest worker that might persist
  0509.io-addressed mail. Verdict: (P1) persisted — name the store + the exact
  read, or (P2) not persisted — the redemption mechanic is post-merge+deploy
  (record; that is a valid outcome, not a failure).

## Your ONE discriminator (~4 minutes, ONE iteration, curl -v, then verdict)

Exactly handoff-v4 steps 1-4 (signup → D1 verification read recording identifier+expiresAt+now → forged-state STAGE-GET -v → confirm POST -v), with these EXTRA records:
- (TTL) verification.expiresAt vs. your confirm-POST wall time — if >90s elapsed, note the TTL receipt.
- (a) STAGE-GET 302: does it carry `set-cookie: f9_better_magic=...`? Record FULL attrs.
- (b) confirm POST: does the request `cookie:` header contain `f9_better_magic=`?
- (c) Location: `/app...` = SUCCESS (go burst) | `?error=callback_failed` = verdict (c).
Verdict → action:
- (c)+(P1): redeem from the persisted store — patch `.fleet/burst-3322.sh` (first leave dated
  backup `.fleet/burst-3322.sh.pre-<why>-<UTCts>`), smoke ONE account (i=21, email bet1-3322-21@0509.io,
  END-TO-END: signup → redemption → import → 302 `/app/onboard?step=first-brief`), then if smoke=ok run
  the burst `bash .fleet/burst-3322.sh 1 20` (expect ok>=20; 2 flakes tolerated; NO retries past the box).
- (c)+(P2): NO burst (it cannot work this unit — 30+ already-dead signups prove it). Record the (a)/(b)
  attrs + the P2 verdict; the PR + follow-up carry the redemption mechanic. Use your leftover minutes on
  the AFTER-reads below.
- (a)=no or (b)=no: record the verbatim headers; ONE forced-cookie confirm retry (`-H "cookie: f9_better_magic=<v>; f9_better_magic_state=<s>"`); still failing → P-branch anyway.

## AFTER-reads (do these REGARDLESS of burst outcome, ~2 min)

- D1 counts (source deploy-ci.env; skip-to-first-`[` extractor; the 17:00Z command): watchlist, users,
  watchlist_run, watch_event, digest_item, delivery_attempt by lane/status, verification count — PLUS
  `SELECT id,user_id,name,created_at,last_scanned_at FROM watchlist ORDER BY created_at DESC LIMIT 25;`
  (if the burst succeeded, 20 new rows prove the cohort; if it did not, this is the baseline receipt).
- BOTH guards read-only WITH env sourced (the exit=2 lesson): `node scripts/canary-cta-detector.mjs --json`
  and `node scripts/canary-digest-headline-ratio.mjs` — record verbatim verdict lines + exit codes.
  NOTE: the guard APPENDS its history file on a real remote sample; that is its designed behavior, fine.

## Writes (ALLOWED, nothing else)

- APPEND your `## 2026-09-14T<HH:MM>Z (unit-6)` section to `.fleet/phase-1-receipts.md`: what you ran,
  (a)/(b)/(c)+P verdicts, verbatim failures, AFTER counts, exact left-overs. End the section with
  `phase-1: <done|partial> — <one line>`.
- ONLY IF you patched it: `.fleet/burst-3322.sh` + its dated backup. No other writes, no new files.
- NO commit, NO push, NO gh writes.

## 10-minute stall rule

Blocked >10 min on anything: append what you have (including the verbatim blocker as your FINAL line),
end. A receipts-only unit-6 still beats a 17th death.

Finish with: `## Completed`, `## Files Changed`, `## Notes`.
