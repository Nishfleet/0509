## Why

Issue #2109 — audit attribution-marker coverage on every public signup CTA across the compare/switch/locale routes. The Fable + Kimi K3 conference on 0509 acquisition found 0 signups Jul-Sep and 0 real paying customers; every public SEO page's signup CTA must carry an allowlisted `source=` marker so funnel measurement can attribute the signup start to the page that drove it.

## Scope

- `tests/signup-source.test.ts` (modified) — new describe block that renders every compare/switch/locale route and asserts that every page-specific signup link carries an allowlisted `source=` marker. The shared header "Sign up" pill (class `ld-nav-pill`) is a global nav element, not a page-specific CTA, so it is excluded; any page-specific signup link that drops its marker fails the test before it can ship an unattributed CTA.

## Audit result (step 1: enumerate every signup CTA href)

The page-specific signup CTAs across the compare/switch/locale routes, and their markers:

| Route | Signup CTA | Marker |
|---|---|---|
| `compare.magicbrief` | `MIGRATION_SIGNUP_PATH` | `source=magicbrief-migration` ✓ |
| `$locale.sneaker-resale` (via `SneakerResaleLanding`) | `sneakerResaleSignupPath(locale)` | `source=locale-*-sneaker-resale` ✓ |
| `$locale.pricing` (re-exports EN pricing) | `PricingSection` Free card CTA | `source=pricing-free` ✓ |

Every other compare/switch/locale route has no page-specific signup CTA (their only CTA is the free search preview, which is not a signup). The shared header "Sign up" pill (`/auth/signup`, no marker) is a global nav element used across all public routes, not a page-specific CTA, so it is out of scope for this issue's compare/switch/locale route audit.

Step 2 (add the route's allowlisted `source=` marker where missing): no page-specific signup CTA in scope was missing a marker — all three already carry an allowlisted marker. No new marker strings were invented (per must-not).

Step 3 (test): the new describe block in `tests/signup-source.test.ts` renders all 37 compare/switch/locale routes and asserts every page-specific signup link carries an allowlisted marker. Verified it fails when a marker is dropped (temporarily removed `source=magicbrief-migration` from `compare.magicbrief` → the test failed on `/compare.magicbrief` and `/$locale.compare.magicbrief`).

## Verification

Termination command (`npm run typecheck && npx vitest run tests/signup-source.test.ts`):

```
NODE_OPTIONS=--max-old-space-size=6144 npm run typecheck
→ exit 0

NODE_OPTIONS=--max-old-space-size=6144 npx vitest run --configLoader runner --project node tests/signup-source.test.ts
→ 1 file, 16 tests passed
```

Related route tests (sneaker-resale, pricing, for-agencies, compare-pages-sources, signup-source):

```
NODE_OPTIONS=--max-old-space-size=6144 npx vitest run --configLoader runner --project node tests/sneaker-resale.route.test.ts tests/pricing.route.test.ts tests/for-agencies.route.test.ts tests/compare-pages-sources.test.ts tests/signup-source.test.ts
→ 5 files, 69 tests passed
```

run-proof: `npm run typecheck` exit 0; `tests/signup-source.test.ts` 16 tests green; related route tests 69 green in the same vitest node-project run.

net-positive-because: this is the issue's own acceptance — the test is the load-bearing new code (a detector that every compare/switch/locale route's signup CTA carries an allowlisted marker), and the audit confirms the page-specific CTAs in scope already carry markers. It is product work, not control-plane machinery.

Closes #2109
