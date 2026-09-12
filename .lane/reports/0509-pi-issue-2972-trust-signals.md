# Lane report — issue #2972 structured data + trust signals

Branch: `claim/issue-2972`
Base: `origin/main` at `7206d079d`
Unit: `pi-issue-0509-2972`

## What shipped

- `app/lib/seo.ts` — `organizationJsonLd()` enriched with `logo`
  (`/apple-touch-icon.png`, the real 180x180 PNG already served from
  `public/`), `contactPoint` (published `support@0509.io` + `/help`), and
  `sameAs` (`https://github.com/Nishfleet` — the only identity page that
  verifiably exists; no invented social profiles).
- `app/lib/monitoring-coverage.ts` (new, pure) — `monitoringCoverageDays()`
  day math shared by `/status` and the marketing footer so both quote the
  same honest figure (never a fabricated uptime %).
- `app/lib/public-status-counters.server.ts` — `getMonitoringCoverageDays(env)`:
  one bounded `MIN(baseline_at)` read; null without DB, errors propagate for
  the route to degrade explicitly.
- `app/components/marketing-footer.tsx` — optional `monitoringCoverageDays`
  prop; when set the footer renders `Status — N days of continuous scheduled
  monitoring`; when absent it renders the Status link alone.
- `app/routes/marketing.tsx` + `app/routes/pricing.tsx` — loaders read the
  figure behind try/catch (country-neutral, safe inside the shared-cached
  document) and pass it to the footer.
- `app/routes/status.tsx` — private `coverageDays` replaced by the shared
  helper, identical math.
- Customer references: deliberately NOT rendered — real quotes need Nish
  (product/brand). A marked slot comment sits between the stats belt and
  `PricingSection` in `marketing.tsx`.

## Verification

- `npx vitest run --configLoader runner --project node tests/funnel-seo.test.ts
  tests/public-status-counters.test.ts tests/pricing.route.test.ts
  tests/marketing-pricing-latency.test.ts tests/ads-internal-links.test.ts
  tests/status.route.test.ts tests/homepage-country-neutral.test.tsx`
  → 82/82 pass.
- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 4414/4415 pass; the 1 failure was this branch's own loader-shape
  assertion, fixed in-diff (all three `toEqual` loader contracts now declare
  `monitoringCoverageDays`).
- `sgscan` → no new findings.
- `crgate` → "CodeRabbit is not signed in on this machine" (gate unavailable).
- Live check before change: `curl https://0509.io/` showed bare
  Organization JSON-LD and no uptime figure in the footer.
