# Lane report — claim/issue-1560

Adyntel integration evaluation — build vs buy for Meta Ad Library data
(issue #1560).

## Change

`docs/adr/2026-09-05-adyntel-meta-data-strategy.md` — new ADR (first file
under `docs/adr/`). Documents the build-vs-buy decision for the raw Meta Ad
Library feed that powers `/search`, the monitoring pipeline, and
`/ads/:domain` pages.

Contents, per the issue's accept criteria:

- Current state: owned scraping pipeline —
  `app/lib/meta-library-browser.server.ts` (2,499 lines) driving the
  Cloudflare Browser binding against the live Ad Library UI.
- Option A: continue owning (proxies, CAPTCHA solving, open-ended parser
  maintenance, ToS risk stays on 0509).
- Option B: adopt Adyntel as the raw feed, keep the longitudinal layer
  (`landing_page_snapshot` in `migrations/0001_app.sql`, `discovery_*`
  ingestion tables in `migrations/0008_commercial_ad_ingestion_replacement.sql`)
  in-house; owned scraper retained as warm fallback.
- Cost projection at the issue's stated scale (1,000 watchlists x 24
  checks/day x ~50 ads/check = 1.2M fetches/mo): ~$8k-$11k/mo across
  Adyntel's published tiers, with caveats on credit-unit semantics and the
  fact that near-term volume is far lower.
- SLA comparison, ToS risk shift, moat preservation, fallback plan.
- Recommendation: Option B, phased, scraper retained as fallback.
- Decision: PENDING — money + legal is owner-reserved; blocking questions
  and the post-decision follow-up epics (migration phases vs.
  pipeline-hardening epic) are enumerated in the ADR.

## Verification

- `ls docs/adr/*adyntel*` -> file exists.
- `grep -q "Option A\|Option B\|Cost projection\|SLA\|ToS risk\|Moat
  preservation\|Fallback" docs/adr/*adyntel*` -> match.
- `grep -q "Decision:\|Chosen:" docs/adr/*adyntel*` -> `## Decision:` section.
- `npx vitest run tests/lane-evidence-collision.test.ts
  tests/docs-no-ghost-ledger-ref.test.ts` -> green; these are the two suites
  that glob docs/ or all tracked files and could interact with a new
  markdown file.

No code, no schema, no CI path changes. Docs-only PR.
