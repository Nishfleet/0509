# Phase-1 handoff v4 — issue 3322, unit-4 (2026-09-13, written 19:15Z by the manager)

You are the fresh phase-1 worker. Worktree: `/home/nish/workspaces/agent-worktrees/issue-0509-3322`,
branch `claim/issue-3322`. HARD BOX: 15 minutes from your start. Do NOT rebase, push, PR, comment, or label.

Read (in this order, ~3 min):
1. `.fleet/plan-3322.md` — manager plan (your scope = phase 1 ONLY).
2. `.fleet/phase-1-handoff-v3.md` — the standing phase-1 instructions (burst mechanics, receipt duties,Allowed-writes list). Your section header: `## 2026-09-13T<HH:MM>Z (unit-4)`.
3. `.fleet/phase-1-receipts.md` — prior attempts: 07:xxZ (1 signup, 0 redeemed), 17:00Z (20/20 signups, 0/20 redeemed, every confirm 302→`?error=callback_failed`, 0 set-cookie).

## Manager code-read verdicts (2026-09-13 19:0xZ — CLEAR hypotheses; do NOT re-chase these)

All in `app/lib/better-auth.server.ts` + `app/routes/auth.better.magic-link.tsx`:
- Relative `callbackURL=/app` in the legacy `?token=` staging URL is FINE: `parseSameOriginUrl` (`:1681`) does `new URL(value, origin)` — absolutizes, returns `https://0509.io/app`.
- Confirmation-cookie `Path=/auth` (`:23`, used `:1014`) covers the confirm POST `/auth/better/magic-link`. Not a path mismatch.
- `BETTER_AUTH_URL=https://0509.io` (`wrangler.jsonc:66`) matches the staging request origin; `betterAuthBaseURL` (`:750`) → same origin. No origin drift.
- `readCookies` (`:1523`) splits on `;` + `startsWith(name=)` — `f9_better_magic` vs `f9_better_magic_state` do not clash.
- The confirm-POST has NO `?ticket=` → `readBetterAuthMagicLinkTicketIds` yields [] (legacy staged cookie has no ticketId, and `readBetterAuthMagicLinkConfirmationCookies` `continue`s on ticketless cookies) → the read FALLS THROUGH to `readBetterAuthLegacyMagicLinkConfirmationCookie` (`:1110`), which needs ONLY: decrypt + `callbackURL` string + `expiresAt > now` + mode + `token` + parseSameOriginUrl(callbackURL). The staged legacy cookie's `expiresAt` = staging-time + 15 MIN (`:1007-1010`), NOT the 90 s verification TTL.
- The confirm action's `completeBetterAuthMagicLinkSignIn` (where the 90 s D1-verification TTL finally matters) is NOT wrapped — it would 500, not 302. Receipts show 302 `?error=callback_failed` ⇒ the failure is strictly in `readBetterAuthMagicLinkVerificationTicket` returning null ⇒ the `f9_better_magic` confirmation cookie was NOT SENT by curl on the confirm POST, or did not decrypt/validate.

⇒ **TTL/pacing is CLEARED as the primary suspect.** The 17:00Z "past the 90 s TTL" hypothesis is WRONG on the code evidence.

## Your ONE discriminator (do this FIRST, ~3 min, ONE iteration, curl -v, headers dumped)

1. signup POST `/auth/signup` (Origin header REQUIRED — receipts) → 302 `?sent=1`.
2. D1: newest `verification.identifier` for YOUR email (source deploy-ci.env; skip-to-first-`[` extractor).
3. FORGE state cookie in the jar (`f9_better_magic_state`) + STAGE-GET `/auth/better/magic-link?token=<t>&mode=signup&callbackURL=/app&newUserCallbackURL=/app&state=<s>` with `-v -D -`:
   - (a) Does the 302 response carry `set-cookie: f9_better_magic=...`? RECORD the FULL attribute string (Domain? Secure? SameSite? Max-Age? more than ONE f9_better_magic set-cookie — the legacy-path clear?).
4. confirm POST `/auth/better/magic-link?mode=signup` (Origin + forged/now-cleared state cookie) with `-v`:
   - (b) Does the request's `cookie:` header CONTAIN `f9_better_magic=`? (grep the -v output, not the jar).
   - (c) The 302 Location: `/app...` (SUCCESS — proceed to import) or `/auth/signup?error=callback_failed`?

Verdicts → actions:
- (a)=no ⇒ staging-encryption/Set-Cookie issue: record the verbatim response headers; check `replacementBetterAuthMagicLinkConfirmationCookies` (`app/lib/better-auth.server.ts` ~:1324-1380) for what the 302 should carry vs what it carried. Then try ONE code-side explanation, record file:line; a CODE FIX is allowed ONLY if it is a ≤5-line, obviously-durable fix (tests: none required for receipts-phase; note it in receipts). Otherwise record + move on.
- (a)=yes,(b)=no ⇒ curl-jar attr mechanics: record the set-cookie attrs; retry the confirm POST with the confirmation cookie FORCED (`-H "cookie: f9_better_magic=<value>; f9_better_magic_state=<state>"`, no jar) — if THAT 302s to /app, the bug is purely jar/attr mechanics: patch `.fleet/burst-3322.sh` accordingly (use forced header, or `-b`/`-c` on the SAME jarfile, or copy the exact attr) and GO TO THE BURST.
- (a)=yes,(b)=yes,(c)=callback_failed ⇒ decrypt/validate-side: record; try ONE variant (e.g. also include a fresh `newUserCallbackURL=https://0509.io/app` ABSOLUTE in the staging URL — the receipts' callbackURL was relative `=/app`; although cleared by code-read, the absolute variant is one curl flag). 2 attempts max, then STOP, record, and burst with whatever variant last got furthest.

On the farthest step.

## Then the burst (receipts duties = handoff-v3 steps 3-5, unchanged)

- ≥20 competitor workspaces, watchlist each, through the product surface ONLY (script steps 1-6; import = `intent=create-market-desk-import`, also queues the activation first scan).
- Edit `.fleet/burst-3322.sh` as needed (leave dated backup sibling `pre-<why>-<UTCts>`). Pacing: 3 s sleeps already in; keep under the 15-min box — 20 iterations × ~35-45 s ≈ 12-15 min. If the box will not fit 20, run 12 (receipt: >=20 is the goal; 12 + prior 20 unredeemed signups + your delta receipts beat 0 — but ONLY if the box forces it; prefer 20).
- Prod-D1 AFTER-reads (watchlist, users, watchlist_run, cta_pipeline_stage_counts delta, delivery_attempt lane='customer', digest_item, watch_event) + BOTH guards read-only WITH env sourced (exit=2 lesson) — record verbatim outputs.
- APPEND `## 2026-09-13T<HH:MM>Z (unit-4)` to `.fleet/phase-1-receipts.md`: what you ran, verbatim failures, counts, the discriminator verdict, exact left-overs. Allowed writes: that receipts file, `.fleet/burst-3322.sh` (+dated backup if edited), `bet1jar.txt`. NOTHING else, NO new files outside `.fleet/`.
- COMMIT: `wip(3322): phase-1 unit-4 — <one line>`. NO trailers, NO Co-Authored-By, NO "Generated with" (agent names forbidden).

## 10-minute stall rule

Blocked > 10 min on anything: write what you have in the receipts (including the verbatim blocker), commit, end your report with the blocker as your FINAL line. A receipts-only unit-4 still beats a 10th death.

Finish with: `## Completed`, `## Files Changed`, `## Notes`.
