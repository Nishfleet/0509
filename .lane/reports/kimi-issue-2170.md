# Lane evidence — kimi/issue-2170

Issue: Nishfleet/0509 #2170 — rebuild the first viewport around the free live-search promise (nish-reserved PR).

## What changed

- `app/routes/marketing.tsx` — new H1 ("See the Meta ads any competitor is running right now. Free, no account."), new deck ("Then Five to Nine watches the offer behind those ads and emails you the before-and-after screenshot when it changes. Weekly on Free, every 3 hours on Starter."), honest note keeps the screenshot-coverage qualifier above the fold, meta description leads with the search promise, loader additionally returns `changeMark`.
- `app/lib/public-change-mark.server.ts` (new) — one bounded D1 read for the newest confirmed watch event with stored from/to tokens; `pickPublicChangeMark` is the anti-fabrication gate over the shared `readChangeMark` reader. Null degrades to the labelled sample state.
- New under-fold proof block (`ld-change` section): real before/after mark from a tracked public advertiser, or the clearly labelled "Sample" state. Rendered with the landing diff typography (struck old, green new).
- `app/app.css` — `.ld-change*` styles on existing `--ld-*` tokens; square corners (ratchet-clean).
- `scripts/check-homepage-mobile-fold.mjs` — fold canary H1 matcher updated to the new wall (`/see the meta ads/i`).
- Tests: new `tests/homepage-hero-search-promise.test.tsx` (H1 text, logged-out search input + CTA, real vs sample mark block, picker gate); copy-pinned assertions updated in homepage-hero-direction, homepage-proof-date, homepage-proof-capture-age, marketing-rebuild; loader-shape assertions updated in marketing-pricing-latency, ads-internal-links.

## Verification

- `npm run typecheck` — clean (cf-typegen && react-router typegen && tsc -b).
- `npm test` — node project 640 files / 7564 tests passed; workers project 42 files / 206 tests passed.
- `npm run verify:claims` — 21/21 rows PASS, funnel-flag agreement PASS, ga-positioning header PASS, ledger references PASS.
- Full chain `npm run typecheck && npm test && npm run verify:claims` exited 0.

## Notes

- MagicBrief hero callout left untouched: the wipe is #2127's scope and its tests pin the callout; this lane adds no MagicBrief references.
- DESIGN.md needed no edit: it never pinned hero copy; the new hero reuses the ratified landing language and tokens.
