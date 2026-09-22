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

- No `scripts/`, `ops/`, `.github/scripts`, `.lane/`, hooks, wrappers or helper files. `package.json` scripts: **build, dev, test, typecheck, deploy, lint, e2e** — nothing else, and every one of them a vendor command, never a file we wrote. `lint` is `eslint . && knip`; `e2e` is `playwright test`. Amended 2026-09-21 by docs/REBUILD-TRUST.md: the correction ladder's second rung has to be runnable by the agent that is about to be corrected, which means a script name, not a CI-only step.
- Workflows: `ci.yml` and `deploy-production.yml` only; required checks unchanged by name. `ci.yml` also answers `deployment_status`, where `e2e-production` and `lighthouse` run against what was just deployed; neither is a required check, because a check that cannot report on a pull request blocks the merge queue forever.
- Every e2e test traces to a row in `docs/FEATURE-MAP.md`, and every route in `app/routes.ts` has one. Checked by the Opus reviewer on every PR that touches a route; no bespoke test reads either file.
- Every dependency in `package.json` is named in docs/REBUILD-STACK.md with a reason.
- Docs: README, DESIGN, CLAUDE, and the REBUILD docs only; every path a doc names exists (checked in review, not by a bespoke test).
- Tests: every file under `tests/` and `e2e/` tests product behaviour; no test about the fleet, CI, migration numbering or docs.

## E. Cost

- Cloudflare bill for the 7-day soak, extrapolated, under $10 a month at the current brand count, with the per-brand unit cost from docs/REBUILD-COST.md measured, not estimated.
- Billing notifications at $10 and $25 confirmed set.

## F. The 7-day soak

Complete is declared only after seven consecutive days on production with one real workspace tracking at least four brands, every line above green on day 7, and the numbers pasted into #3842 by the deputy with links. Fable checks, Nish sees it last.

## G. Recovery (measured, 2026-09-22)

Every number below is from a drill actually run against a throwaway D1 on the production account, not from a document. The drill is issue #4179.

- **Recovery window: 30 days, and it is the platform's number, not ours.** On the production database `0509` (`746c6e3d-782e-443a-82d6-28ca93a16294`, storage `version: production`), `wrangler d1 time-travel info 0509 --timestamp=<unix>` resolves any timestamp inside 30 days to a bookmark. At exactly 30 days and older the API refuses it outright: `Invalid timestamp '1787495425'. Please provide a timestamp within the last 30 days`. This is the real window for our plan, confirmed by probe rather than assumed. Time Travel is always on and history and restores cost nothing extra.
- **How to take a bookmark: `wrangler d1 time-travel info DB_NAME`.** It prints the current bookmark and the exact restore command for it. In the drill the pre-write bookmark was `00000000-00000010-000050ee-a7622903e256915056aca472ac645aa9` and the post-write one `00000000-00000014-000050ee-cdbead2340fe8863669d80bacceb8fd5`. A past point in time can be converted deterministically with `--timestamp=<unix|RFC3339>`.
- **The exact restore command: `wrangler d1 time-travel restore 0509 --bookmark=<bookmark>`.** It overwrites the database in place and is destructive. The drill ran `wrangler d1 time-travel restore 0509-timetravel-drill --bookmark=00000000-00000010-000050ee-…` and the platform answered `✅ Database 0509-timetravel-drill restored back to bookmark 00000000-00000010-000050ee-…`.
- **Measured restore time: 7 s wall clock.** Unix start `1790089179` → end `1790089186`; UTC `2026-09-22T14:59:39Z` → `14:59:46Z`. The whole drill — take a bookmark, write a row, restore, count all 32 tables before and after, delete the throwaway — took **145 s** end to end (`14:58:30Z` → `15:00:50Z`).
- **What the drill proved.** Against a throwaway `0509-timetravel-drill`, the two migrations applied cleanly (32 tables, 5 seeded `source` rows). A `user` and a `workspace` row were inserted, and a count proved both present (`workspace=1`, `user=1`). After restoring to the pre-write bookmark both were gone (`workspace=0`, `user=0`). Every other table's row count before and after was identical — the diff was empty across all 32 tables — so the restore removed the accidental write and left the schema and the seeded history intact.
- **Recovery point objective, in plain words.** A restore can put the database back to any minute within the last 30 days. So the tracking history a restore would cost at the worst moment is only what was written between the chosen recovery point and the accident: you step back to just before the bad write and lose the one bad write, not the history in front of it. The 30-day window is how far back you can reach, not how much you lose. Bookmarking a known-good point before a risky migration or a bulk edit sets the step-back target deliberately. The exposure that remains is the gap nobody bookmarked: whatever arrives between the last point you can name and the accident, and that gap is measured in minutes at the write volumes `wrangler d1 info 0509` reports (830 rows written in 24 h).
- **No script, no cron, no helper.** Time Travel is the platform feature and needs none. Nothing in this repository runs a backup.
