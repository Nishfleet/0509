Closes #2455

## What
Replaced the local `decodeHtml` in `app/lib/landing-page-signals.server.ts` with the shared single-pass `decodeHtmlEntities` from `~/lib/decode-html.server.ts` (per the binding judge edit; the nbsp-in-alternation fallback was withdrawn). The local function is deleted.

`cleanText` now shields the issue-#1409 guard around the shared decoder: hex entities for lone surrogates (`0xd800`–`0xdfff`) and out-of-range scalars (`> 0x10ffff`) stay literal. The first cut of the shared-decoder swap regressed the pinned `tests/cta-entity-decode.test.ts` guard test ("leaves an out-of-range hex entity untouched") — the full `--changed origin/main` run caught it RED, and the shield commit (ee0d6a1b) turns it GREEN without weakening the pinned test.

## Verification
- RED first, exactly as the repro line describes:
  `expect(extractLandingPageSignals("<button>Buy&nbsp;Now</button>").ctaText).toBe("Buy Now")`
  → failed with `"ctaText": "Buy&nbsp;Now"` before the fix (`npx vitest run tests/landing-page-signals.test.ts`: 1 failed | 67 passed).
- GREEN after the shared-decoder swap: targeted run `tests/landing-page-signals.test.ts` + `tests/decode-html-entities.server.test.ts` → 77 passed.
- Regression caught: `npx vitest run --configLoader runner --project node --changed origin/main` → 2 failed / 4626 passed; the failures were (a) the #1409 surrogate-guard test (real, fixed by the shield) and (b) `tests/watchlists.route.test.ts` missing the `axe-core` package from the worktree's partial node_modules (environmental; `axe-core@^4.13.0` is declared in package.json, the branch does not touch package.json — installed the declared version, then the test passes: 35/35).
- Final: targeted run `tests/landing-page-signals.test.ts tests/cta-entity-decode.test.ts tests/decode-html-entities.server.test.ts` → 81/81 passed; full `--changed origin/main` node suite → **354 files, 4628 tests, all passed** (rc=0).
- run-proof: unit pi-issue-0509-2455; inner-loop rounds: RED (repro) → GREEN (swap) → RED (guard regression) → GREEN (shield) → full-suite green; no retries, no wrapper.
- Typecheck: per the worker memory budget rule (fleet-ops#4891) `npm run typecheck`/`tsc -b` is not run inside a worker on 0509; PR CI is the typecheck round-trip.

## Same-pattern sweep (step 3)
Searched `app/` for other local entity-decode regexes (`function decodeHtml`, `replace(/&.../`): no other decoder instances exist. `app/lib/social-cards.server.ts` ENCODES entities (reverse direction, not this pattern); `app/lib/meta-library-rendered-card-parser.server.ts` tolerates `&nbsp;` in a status regex (already correct). All decode paths use the shared `decodeHtmlEntities`.

## Accepted one-time effect
On the first capture after deploy, stored CTAs containing literal `&nbsp;` normalize and fire one `landing_page_cta_changed` event per affected page. No backfill, no dual-decode transition logic.

## Test plan
- `npx vitest run tests/landing-page-signals*.test.ts` — green (81/81 across the three entity-related files)
- PR CI typecheck + full test suite

loose-ends: none

## Reviewer round (senior seat: opencode/nemotron-3-ultra-free)
- Verdict: no Act-on findings, no blocking. Ship it.
- Noted (acted on in ee0d6a1b): shared decoder accepts lone-surrogate hex code points where the old local one refused them — resolved by the #1409 guard shield in `cleanText`, pinned green by `tests/cta-entity-decode.test.ts`.
- Consider (acted on): stale "alongside cleanText / decodeHtml" comment updated (9d43e0f3).

## Gates
- `bin/fleet-no-agent-names-check --commit-range origin/main..HEAD` → OK: no agent attribution detected
- `sgscan` → no new security findings
- `crgate` → failed: CodeRabbit is not signed in on this machine (environmental; CodeRabbit CI check on the PR shows pass/Review skipped)
- `bin/prove-one-run-check` → no new machinery in this diff; run-proof line present above
