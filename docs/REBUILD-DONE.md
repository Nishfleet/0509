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
| J8 | Your own site breaks | incident email within one tick, "fixed" follow-up after repair, one email per incident |
| J9 | Mentions land from three sources | news, HN, RSS at minimum; homonym mention correctly dropped (D5) |
| J10 | New ad creative appears | visible on the competitor page within one tick, deduped on re-crawl |
| J11 | The weekly brief | real inbox, real workspace, order per docs/REBUILD-DELIVERY.md, quiet-week variant also sent |
| J12 | Two weekly rollovers | standing rows match Home and the brief (docs/REBUILD-STANDING.md), movement correct after a brand went off |
| J13 | Upgrade to paid | Dodo checkout from the plan gate, webhook lands, entitlement flips without a reload |
| J14 | Delete the workspace | every owned row gone (ownership manifest), R2 objects gone, no email after |

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

- No `scripts/`, `ops/`, `.github/scripts`, `.lane/`, hooks, wrappers or helper files. `package.json` scripts: build, dev, test, typecheck, deploy only.
- Workflows: `ci.yml` and `deploy-production.yml` only; required checks unchanged by name.
- Every dependency in `package.json` is named in docs/REBUILD-STACK.md with a reason.
- Docs: README, DESIGN, CLAUDE, and the REBUILD docs only; every path a doc names exists (checked in review, not by a bespoke test).
- Tests: every file under `tests/` and `e2e/` tests product behaviour; no test about the fleet, CI, migration numbering or docs.

## E. Cost

- Cloudflare bill for the 7-day soak, extrapolated, under $10 a month at the current brand count, with the per-brand unit cost from docs/REBUILD-COST.md measured, not estimated.
- Billing notifications at $10 and $25 confirmed set.

## F. The 7-day soak

Complete is declared only after seven consecutive days on production with one real workspace tracking at least four brands, every line above green on day 7, and the numbers pasted into #3842 by the deputy with links. Fable checks, Nish sees it last.
