# Lane evidence — claim/issue-3358

Issue: Nishfleet/0509#3358 — tag `source=` on every acquisition-surface-family
signup CTA so the direction#4518 signups/week meter can slice by surface.

## What shipped

- `app/lib/signup-source.ts`: five family markers — `ads-page`,
  `compare-page`, `switch-page`, `timeline-page`, `guides-hub` — added to
  `ALLOWED_SIGNUP_SOURCES`. Hyphen slugs on purpose: 0087's open CHECK class
  is `[a-z0-9:.-]` and the code open shape is `/^[a-z0-9][a-z0-9-]{0,39}$/`,
  so the issue's example `ads_page` spellings would fail the D1 CHECK without
  a migration. Hyphen slugs ride the open shape — no migration shipped.
- `app/components/marketing-nav.tsx`: new optional `signupSource` prop — the
  Sign up pill becomes `/auth/signup?source=<marker>` when passed, bare
  `/auth/signup` otherwise (non-acquisition surfaces keep the bare pill).
- Tagged: `ads.$domain` (pill + both in-page CTA paths), `timeline` +
  `timeline.$domain` (pill + Watch CTA), `compare` hub + 16 compare routes
  via pill, `switch-landing` (covers all 4 /switch routes), `guides` hub +
  all 7 guide articles (each article keeps its per-guide `guide-*` marker).
  `compare.visualping-ad-library` is a bare 301 redirect — nothing rendered.
  `$locale.*` children re-export the EN components (#1562) so they inherit it.
- Persistence reuses the shipped #1200/#2108 path untouched:
  `allowlistedSignupSource` → hidden `signupSource` form field →
  `rememberAllowlistedSignupSource` (pending row + cookie) →
  `applySignupSourceToNewUser` on both password and OAuth paths.

## Tests

- `tests/signup-source-acquisition-families.test.ts` (new file): allowlist
  registration + negative underscore probes, per-file static wiring check
  (FAMILY_WIRING — every acquisition file's marker string), and a component
  render pinning the pill href per family marker + the bare-pill default.
- `tests/integration/signup-source.integration.test.ts`: all five markers
  round-trip remember→apply→read on real workerd D1 through 0087's CHECK.
- `tests/ads-track-cta.test.ts`, `tests/ads-brand-page.render.test.tsx`:
  updated for the new `source=ads-page` param on the /ads CTAs.

## Why a new test file

`tests/signup-source.test.ts`'s issue-#2109 block renders ~30 route modules
in one test and leaves the fork heap near the 2GB vitest ceiling; adding the
#3358 describe after it mark-compacted the fork to death (worker exit, 16/19
reported). The #3358 block moved to its own file — fresh fork — and uses the
repo `tests/helpers/mock-react-router` helper instead of an inline doMock.

## Verify receipt

- `npx vitest run --project node tests/signup-source.test.ts
  tests/signup-source-acquisition-families.test.ts tests/ads-track-cta.test.ts
  tests/ads-brand-page.render.test.tsx tests/marketing-nav.test.ts`
  → 5 files, 93 tests, all pass, 4.8s.
- `npx vitest run --project workers
  tests/integration/signup-source.integration.test.ts` → 9/9 pass, real D1.
- Termination check is post-deploy (`curl .../ads/nike.com | grep
  'auth/signup?source='`); the shipped markup contains
  `/auth/signup?source=ads-page` on the pill and both /ads CTAs.
