# Definition of complete for the rebuild

Umbrella #3842. Author: Fable. Checked by the Opus deputy. Nish's words: "you can't call it complete until it's complete." This is the bar. Every line is a proof on real records, cited by id, path or timestamp. No line may be waived; a line that cannot be met is reported to Nish with the reason.

## A. The journeys (Playwright, desktop 1440 and phone 390, against production)

| # | Journey | Passes when |
|---|---|---|
| J1 | Sign in with a magic link | fresh email, link arrives, session lands on the one-input screen |
| J2 | Sign in with a passkey | register on first sign-in, sign out, sign in with the passkey alone |
| J3 | Onboard a company domain | card confirmed under 30 s, competitors under 60 s, Home not empty (docs/REBUILD-ONBOARDING.md budgets, timings stored) |
| J4 | Onboard a creator handle | same budgets; card shows channel, handle, socials |
| J5 | Onboard a bot-blocking site | card still confirmed; site fields say what fills them and when |
| J6 | Turn a competitor off and back on | off: absent from Home, Alerts, brief; on: history intact |
| J7 | A competitor changes its pricing page | before-and-after mark in Alerts within one tick, correct kind, screenshot pair, in the next brief |
| J8 | Your own site breaks | incident email within one tick, "fixed" follow-up after repair, one email per incident. Fixture is **`fixture.0509.in`** — a separate Worker with its own name and `routes` block, deployed by normal CI, state in a KV flag flipped through a token-guarded route. **Not `0509.in`**: that is a live production redirect (verified 308 to `0509.io`, 2026-09-21) and breaking it on purpose would break production. Break it two ways: hard (500) and soft (200 with the pricing section gone), because only the soft case exercises D3s |
| J9 | Mentions land from three sources | news, HN, RSS at minimum; homonym mention correctly dropped (D5) |
| J10 | New ad creative appears | visible on the competitor page within one tick, deduped on re-crawl |
| J11 | The weekly brief | real inbox, real workspace, order per docs/REBUILD-DELIVERY.md, quiet-week variant also sent |
| J12 | Two weekly rollovers | standing rows match Home and the brief (docs/REBUILD-STANDING.md), movement correct after a brand went off |
| J13 | Upgrade to paid | Dodo checkout from the plan gate, webhook lands, entitlement flips without a reload |
| J14 | Delete the workspace | every owned row gone (ownership manifest), R2 objects gone, no email after |

Decisions recorded on 0509#3927 (2026-09-22):

- **J1's mail sink** is in-stack, no third-party account: an Email Routing rule
  on `e2e@0509.io` delivers to the `0509-e2e-inbox` Worker
  (`workers/e2e-inbox.ts`), which stores the raw message in KV under the
  recipient address with a one-hour TTL. The spec signs up as
  `e2e+<run-id>@0509.io` — per-run tags ride the same rule because
  subaddressing (RFC 5233) is enabled on the zone and preserves the full
  recipient in `message.to` — and reads the message back through
  `GET https://e2e-inbox.0509.io/message?to=<address>`, gated by the repo
  secret `E2E_INBOX_TOKEN`. If the routing rule, the subaddressing toggle or
  the secret is missing at run time the test fails loudly naming which one —
  it never skips. No D1 read, no token-returning route in the app.
- **J2's passkey** is a virtual authenticator via Playwright's CDP WebAuthn
  domain — an accepted J2. It proves the app's WebAuthn wiring; the real-device
  proof stays a one-time manual record. Status 2026-09-22: the affordance
  shipped in #3963 ("Add a passkey" on `/app`, "Sign in with a passkey" on
  `/login`), and `e2e/j2-passkey.spec.ts` drives those real buttons through
  the virtual authenticator — the wire shape is better-auth's client, not
  bytes the spec constructed. Sign-out has no UI affordance yet, so the spec
  ends the session through better-auth's real `POST /api/auth/sign-out` and
  proves it by the `/app` → `/login` redirect before the passkey-only
  sign-in.

## B. Quality gates (each is a number, measured on production)

- Performance: LCP under 1.5 s on simulated 4G for landing and Home; Home JavaScript under 150 KB gzipped; no request over 500 ms on the Home loader at p95 over 100 loads.
- Accessibility: zero WCAG 2.2 AA violations on the seven screens (axe), full keyboard path through J3 and J6, contrast pass in light and dark.
- Mobile: no horizontal scroll at 390 on any screen; bottom tab bar reachable; row expansion as a sheet.
- Errors: zero console errors on the seven screens; error tracking shows zero unhandled exceptions over 7 days of the soak.
- Uptime: dead-man ping live on healthchecks.io for 7 consecutive days with no miss.

## C. Engine proofs (one real brand each, cited)

- Every source in the registry has a live capture in the last 24 h for at least one tracked brand, or is marked degraded in the UI with the reason.
- Every Jev decision D1 to D9 has a logged verdict from a real item (question id, hash, p, timestamp).
- The nightly Workflow ran 7 consecutive nights with no manual intervention; retries visible in the Workflow log, not in a script.

## D. Repository state

- No `scripts/`, `ops/`, `.github/scripts`, `.lane/`, hooks, wrappers or helper files. `package.json` scripts: **build, dev, test, typecheck, deploy, lint, e2e, verify:start, verify:stop** — nothing else, and every one of them a vendor command, never a file we wrote (`verify:start` / `verify:stop` call the stock `chrome-devtools` CLI of `docs/REBUILD-STACK.md` §6.6; #4251). `lint` is `eslint . && knip`; `e2e` is `playwright test`. Amended 2026-09-21 by docs/REBUILD-TRUST.md: the correction ladder's second rung has to be runnable by the agent that is about to be corrected, which means a script name, not a CI-only step.
- Workflows: `ci.yml` and `deploy-production.yml` only; required checks unchanged by name. `ci.yml` also answers `deployment_status`, where `e2e-production` and `lighthouse` run against what was just deployed; neither is a required check, because a check that cannot report on a pull request blocks the merge queue forever.
- Every e2e test traces to a row in `.agents/skills/verify/feature-map.md`, and every route in `app/routes.ts` has one. Checked by the Opus reviewer on every PR that touches a route; no bespoke test reads either file.
- Every dependency in `package.json` is named in docs/REBUILD-STACK.md with a reason.
- Docs: README, DESIGN, CLAUDE, and the REBUILD docs only; every path a doc names exists (checked in review, not by a bespoke test).
- Tests: every file under `tests/` and `e2e/` tests product behaviour; no test about the fleet, CI, migration numbering or docs.

## E. Cost

- Cloudflare bill for the 7-day soak, extrapolated, under $10 a month at the current brand count, with the per-brand unit cost from docs/REBUILD-COST.md measured, not estimated.
- Billing notifications at $10 and $25 confirmed set.

## F. The 7-day soak

Complete is declared only after seven consecutive days on production with one real workspace tracking at least four brands, every line above green on day 7, and the numbers pasted into #3842 by the deputy with links. Fable checks, Nish sees it last.

## G. Recovery (measured, 2026-09-22)

Every number below is measured, on 2026-09-22, and each one is cited to the step that produced it: the window probes ran read-only against production `0509`, and the write / restore / intactness numbers came from a drill run against a throwaway D1 on the same account. The drill is issue #4179 and its full UTC-stamped terminal transcript is pasted in PR #4257's body, which is where the issue asked for it; the identifiers below are the ones in that transcript. The one line that is documentation rather than measurement is labelled as such, and one consequence that the drill could not measure — production's 8 extra tables — is stated as the gap it is rather than folded into the intactness proof.

- **Recovery window: 30 days, and it is the platform's number, not ours.** On the production database `0509` (`746c6e3d-782e-443a-82d6-28ca93a16294`, `wrangler d1 info 0509` reports `version: production` and 40 user tables — a `sqlite_master` query returns 41 rows including `_cf_KV` and `d1_migrations`), `wrangler d1 time-travel info 0509 --timestamp=<unix>` resolved a 29-day-old timestamp to bookmark `00005419-00000004-000050d1-9080e2d68a8462507f0084baf36cf258` and one 29 d 23 h old to `00005409-00000002-000050d1-5f82b8763abdb6389cbd3f4a9cbe556b`. Exactly 30 days and 30 d + 5 min before the probe reference (`2026-09-22T16:34:57Z`) were both refused: `Invalid timestamp '1787502897'. Please provide a timestamp within the last 30 days` and `Invalid timestamp '1787502597'. …`. So the window is **at least 29 days and 23 hours of reach, and under about 30 days 14 minutes** — the two probes sit on either side of the edge, and nothing between 29 d 23 h and 30 d 14 m was probed, so that whole band is unpinned. (Cost of a restore: `$0` additional per the D1 pricing page — documentation, not measurement; history and restores are not separately billed.)
- **How to take a bookmark: `wrangler d1 time-travel info DB_NAME`.** It prints the current bookmark and the ready-made restore command for it. In the drill the pre-write bookmark was `00000004-0000000a-000050ee-b9cde55623c0c53e91279f516f9a099d` and the post-write one `00000004-0000000e-000050ee-bef3524f2e45c743dee9261f2a8a0995`. Unix timestamps are the only form probed; RFC 3339 was not tried, and the finest granularity the conversion resolves to was not probed either — treat it as "pick a second and verify the bookmark."
- **The exact restore command: `wrangler d1 time-travel restore DB_NAME --bookmark=<bookmark>`, and on production it is gated.** It overwrites the database in place and cancels in-flight queries, so it is destructive. The drill ran it against a throwaway (`0509-drill-4179-0922163550`) and the platform answered `✅ Database 0509-drill-4179-0922163550 restored back to bookmark 00000004-0000000a-000050ee-b9cde55623c0c53e91279f516f9a099d`. **Restoring production `0509` needs Nish's explicit authorization** — that is the gate this repo's `CLAUDE.md` puts on production state, and a copy-pasteable command in a doc does not override it.
- **Measured restore time: 11 s wall clock.** Unix start `1790095727` → end `1790095738`; UTC `2026-09-22T16:48:47Z` → `16:48:58Z`. The whole drill — create the throwaway, apply the two real migrations, count every table, bookmark, write two marker rows, bookmark again, restore, re-count every table, delete — ran `16:35:50Z → 16:55:42Z`, **1192 s**. Of that, `d1 migrations apply` was 11 s and the two full-table count passes were the bulk (the drill's wall clock is dominated by 30-odd sequential count queries per pass, not by the restore); the restore itself is 11 s of the 1192 s. Wait times in a real incident scale with write volume and table count, not with this throwaway.
- **What the drill proved.** Against a fresh throwaway `0509-drill-4179-0922163550` (`ddfce716-5ec4-432a-9dd7-cbffb4ab4eaa`), the two real migrations applied cleanly (`wrangler d1 migrations apply` reported 168 commands for `0001_rebuild.sql` and 2 for `0002_parked_ads_sources.sql`; the source file's 176 semicolons include comment lines, so the platform's own count is the one recorded here). Both marker tables pre-exist in `migrations/0001_rebuild.sql` — `scoring_weight` and `email_suppression` at lines 608 and 631 — so the drill read no write into a table the schema does not have. One `scoring_weight` row and one `email_suppression` row were inserted and counted present (`scoring_weight=1`, `email_suppression=1`). After restoring to the pre-write bookmark both were gone (`scoring_weight=0`, `email_suppression=0`). Every table's row count before and after the restore was identical — the diff was empty across all 31 application tables, with `source` still at 5 — so the restore removed the accidental writes and left the schema and the seeded history intact. (`_cf_KV`, a Cloudflare-managed table, and `d1_migrations` also exist and are not counted among the 31.)
- **The throwaway is not the shape of production, and that gap is its own issue.** The throwaway's 31 application tables match `migrations/0001_rebuild.sql` table for table. Production `0509` has 40 user tables (`wrangler d1 info 0509`; `sqlite_master` returns 41 rows with `_cf_KV`), and 8 of them are created by no file in `migrations/`: `dodo_checkout_attempt`, `paid_work_queue`, `passkey_challenge`, `passkey_credential`, `stytch_auth_request`, `stytch_identity`, `stytch_session`, `website_watch_target`. So the intactness proof above is a proof about the 31-table schema the migrations build, not about production's 40, and a restore taken against production would carry 8 tables this drill never exercised. That drift is filed as its own issue and is not decided here.
- **Recovery point objective, in plain words.** The window is how far back you can reach — about 30 days. What an accident costs is the writes between the recovery point you choose and the moment you notice: a point-in-time restore discards everything written after the point you name, not just the bad write, so aiming it early is what loses history. Because any timestamp inside the window converts to a bookmark, the point does not have to be one bookmarked in advance; aim for the second just before the bad write and the loss is only the writes in between. At the worst moment — a bad write discovered 30 days later, at the very edge of the window — the **worst case is the full 30 days of accumulated tracking history**. Measure it from what production actually writes, not what it would write with brands on: `wrangler d1 info 0509` reports 625 write *queries* in 24 h and 1,667 *rows* written in 24 h, and the measured week in `docs/REBUILD-COST.md` is **223,287 D1 rows written** (with **0 brands ON**) — about 956,944 rows a month if that week repeats. So a worst-case restore at today's volume costs on the order of a million rows of accumulated history, and the drill's own two markers prove only that the mechanism empties what was written after the point, not how large that volume is.
- **No script, no cron, no helper.** Time Travel is the platform feature and needs none. Nothing in this repository runs a backup. This drill was driven by `wrangler` commands directly and the throwaway was deleted afterwards (`Deleted '0509-drill-4179-0922163550' successfully`); `wrangler d1 list` afterwards returned no database with `drill` or `4179` in its name, and production `0509` was still listed. The section's full transcript is pasted in PR #4257, which is what this line cites.
