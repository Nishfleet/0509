# Lane evidence — claim/issue-2887 (Nishfleet/0509#2887)

## What shipped

`/switch/magicbrief` — a live, indexable BET 8 wind-down page for the
"MagicBrief alternative / MagicBrief shut down" query class. Built on the
shared `SwitchLanding` renderer via a new `SWITCH_PAGES.magicbrief` registry
entry, EN + locale route modules, sitemap + llms.txt + footer + compare-hub
linkage, and the shared `/search` preview CTA pointing at the tracked demo
brand (`FREE_PREVIEW_SEARCH_DOMAIN`), never at the dead vendor domain.

`/compare/magicbrief` (EN + locale twins) keeps its existing 301 → `/compare`;
only the switch path came back to life.

## Verified public facts the page cites

- `https://magicbrief.com/faqs` (fetched live 2026-09-11, HTTP 200):
  "With Canva Grow now live, MagicBrief will close on July 31, 2026." Also:
  Inspire collections have no bulk export; Insights reports exported as CSV
  until shutdown; Canva Grow runs on every Canva plan with the highest usage
  tiers inside Canva Business; Canva Grow is a net-new product, not a port.
- `https://www.canva.com/pricing/` (verified 2026-09-11): Canva Business at
  US$250/year per person (US$25/month).
- `https://magicbrief.com/post/magicbrief-canva-acquisition` (HTTP 200,
  2026-09-11): the Canva acquisition post.

## Proof

- `npx vitest run tests/switch-magicbrief-route.test.ts` — 8/8 pass
  (issue's termination command).
- `npx vitest run --configLoader runner --project node --changed origin/main`
  — 365 files / 4430 tests, all pass.
- Live dev server (`E2E_TEST_MODE=1 react-router dev` on 127.0.0.1:4189):
  - `GET /switch/magicbrief` → 200, canonical `https://0509.io/switch/magicbrief`,
    shutdown quote, US$250 bundle fact, both source links, "What transfers" /
    "What does not transfer" sections, `href="/search?q=nike.com"` CTA.
  - `GET /de/switch/magicbrief` → 200 (canonical → EN).
  - `GET /compare/magicbrief` → 301 → `/compare` (wipe preserved).
  - `GET /sitemap.xml` contains `/switch/magicbrief`; `GET /de/sitemap.xml`
    contains `/de/switch/magicbrief`; `GET /llms.txt` advertises it.
  - `GET /compare` contains `href="/switch/magicbrief"`.
  - `GET /social-card/switch/magicbrief.svg` → 200.
- `sgscan --base origin/main` — no new security findings.
- `crgate` — could not run: CodeRabbit is not signed in on this host
  (exit 3; `coderabbit auth login` is operator-side).

## Notes for the reviewer

- Public competitor claims (shutdown wording, Canva Grow successor framing,
  the US$250/seat-yr bundle line) are flagged for the [NISH] voice/claims
  gate per the issue.
- The `US$250` figure appears only in visible copy (deck + "official
  successor" section + source label), never in meta description or JSON-LD
  blocks — the switch-page test bans prices inside structured data.
