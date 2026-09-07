# BET 9 first-viewport verification — #976

Verification record for the §3.4 BET 9 termination check
(category-research.md §3.4, issue #976). The canary is
`scripts/bet9-first-viewport-verification.mjs` (`npm run canary:bet9`).

## Termination check

> Desktop + mobile screenshots at 1440 and 390 showing headline, value
> proposition, and a clickable CTA all within the first viewport; zero console
> errors; no horizontal scroll; `scripts/design-system-ratchet.mjs` ceilings
> unchanged or lower.

## Run (current `main`, deterministic fixture server)

Build: `npm run e2e:serve:local` → `http://127.0.0.1:4179`
(`E2E_TEST_MODE=1`, loopback worst-case headline + proof-strip injection on).

Command:

```
node scripts/bet9-first-viewport-verification.mjs --base-url http://127.0.0.1:4179
```

Result: **Termination PASS** (exit 0).

```
PASS desktop 1440x900 fold=900
  PASS headline_in_first_viewport: headline top=216.92 bottom=411.48 fold=900 in
  PASS value_proposition_in_first_viewport: value proposition top=588.09 bottom=732.08 fold=900 in
  PASS cta_in_first_viewport: CTA top=752.08 bottom=827.69 fold=900 in
  PASS cta_clickable: tag=BUTTON type=submit disabled=false pointer-events=auto
  PASS no_horizontal_scroll: scrollWidth=1440 clientWidth=1440 overflow=0
  PASS no_nested_overflow_in_first_viewport: first-viewport nested overflow: 0
  PASS zero_console_errors: console errors: 0

PASS mobile 390x844 fold=844
  PASS headline_in_first_viewport: headline top=314.17 bottom=447.14 fold=844 in
  PASS value_proposition_in_first_viewport: value proposition top=593.17 bottom=707.17 fold=844 in
  PASS cta_in_first_viewport: CTA top=763.17 bottom=807.97 fold=844 in
  PASS cta_clickable: tag=BUTTON type=submit disabled=false pointer-events=auto
  PASS no_horizontal_scroll: scrollWidth=390 clientWidth=390 overflow=0
  PASS no_nested_overflow_in_first_viewport: first-viewport nested overflow: 0
  PASS zero_console_errors: console errors: 0

Termination: PASS — headline, value proposition, and clickable CTA are in the first viewport at 1440 and 390.
```

Screenshots: `desktop-1440.png`, `mobile-390.png` (this directory).

## Ratchet

```
node scripts/design-system-ratchet.mjs
Ratchet clean. Remaining legacy markers: 471.
```

Ceilings unchanged (471 legacy markers, no increase).

## What this proves

The BET 9 fold fix (#971, merged in PR #1174 as `546771fa`, plus the follow-up
`c0607af2`) puts the headline, value proposition, and the clickable search CTA
inside the first viewport at both 1440x900 and 390x844 against the current
`main` build, with zero console errors and no horizontal overflow — including
no nested element overflowing its box inside the first viewport.

## Live site status (pending deploy)

`https://0509.io` is still serving the pre-#971 layout as of 2026-08-27 because
every `deploy-production` run since ~2026-08-26 20:40 UTC is failing on a
release-e2e nested-overflow regression unrelated to the first viewport: the
"Read the methodology" link in `.ld-proof-actions` overflows its box by ~16–20px
on mobile (top≈1495, **below** the first viewport). That defect is filed as
#1262 and blocks the deploy of #971's fix to production. Live re-verification
will run once #1262 is green and the deploy lands.

## Mechanism added in this verification pass

The canary previously checked only document-level horizontal scroll
(`scrollWidth <= clientWidth`). The release e2e
(`e2e/helpers/release-experience.ts` `expectNoHorizontalOverflow`) also rejects
nested elements whose content overflows their own box. That gap let the canary
PASS while the deploy gate went RED. This pass adds
`no_nested_overflow_in_first_viewport` — the canary now scans every element
whose box starts inside the first viewport and fails if any overflows its box
by more than the 2px release-e2e floor. A below-the-fold overflow (the #1262
class) is deliberately out of scope for this first-viewport gate.
