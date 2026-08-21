# Proof-backed "competitor monitoring software" category landing page — already resolved, re-verified on current main tip

**Status: already resolved; this lane records the evidence only.**

Branch: `0509-lane2-competitor-monitoring-category-already-resolved`
Base: `origin/main` at `422fbd55` (#806)
PR: Nishfleet/0509 (this evidence branch)

## Item

- [ ] Publish a proof-backed category landing page for "competitor monitoring software"
      [research-desk 2026-08-08, risk: amber, backlog item d011a82125]

## Verdict

No product code change was warranted. The item shipped as **PR #572** (2026-08-09, the
original research-desk delivery), was re-landed at main as **PR #742** (merged
2026-08-19) after the real-proof fork, and the real-proof hardening landed via
**PR #633** (merged 2026-08-11) and **PR #806** (merged 2026-08-21, current main tip).
The page is **live at https://0509.io/competitor-monitoring** and serves the acceptance
surface verified below. This lane re-verified the whole acceptance chain at the current
main tip instead of duplicating the work.

## What the merged chain shipped (acceptance mapping)

- **`app/routes/competitor-monitoring.tsx`** — category landing page:
  - Truthful title/meta/canonical: "Competitor monitoring software | Five to Nine",
    description under 160 chars, `canonicalLinks("/competitor-monitoring")`.
  - `WebPage` + `FAQPage` JSON-LD emitted from the same arrays as the visible copy
    (FAQ can never drift from what renders).
  - Category-positioning cards (Panoramata, Watch Ads, PageCrawl, Octolens) and
    complaint cards (Skopx, Flares) each carry their source URL and the 2026-08-08
    research-desk check date, scoped as "checked" quotes, not standing facts.
  - Real-proof loader: renders the featured competitor's real captures from the
    discovery cache only via `loadPublicProofBrief`; with no usable real cache it
    renders the honest "No live proof right now" state — never a sample fixture.
  - No hardcoded prices, no unsupported superiority claims.
- **`app/routes.ts`** — `route("competitor-monitoring", "routes/competitor-monitoring.tsx")`
  registered.
- **`app/lib/seo.ts`** — `/competitor-monitoring` in `SITEMAP_PATHS` (static sitemap entry).
- **`app/lib/public-proof.server.ts`** — `buildSummary` joins website and library phrase
  with a separator (PR #806) so the flagship real-proof sentence cannot glue the domain
  to the following word.
- **`tests/competitor-monitoring-category.test.ts`** — 9 acceptance tests: shared
  nav/footer/hero shell, truthful meta + no unsupported ranking claims, WebPage JSON-LD
  matching visible copy, FAQPage JSON-LD matching visible FAQ exactly (including plan
  cadence parity with entitlements and no price amounts), internal links
  (search/docs/pricing/homepage), explicit source/freshness limits per market claim,
  real proof never a sample/illustrative fixture with honest empty state, no hardcoded
  prices or superiority claims, sitemap inclusion.

## PR chain

| PR    | Title                                                        | State                    |
|-------|--------------------------------------------------------------|--------------------------|
| #572  | feat(seo): publish proof-backed /competitor-monitoring category page | closed (superseded) |
| #633  | feat(proof): real proof on every public surface — kill sample/illustrative demos | merged 2026-08-11 |
| #742  | feat(seo): publish proof-backed /competitor-monitoring category page | merged 2026-08-19 |
| #806  | fix(proof): real-proof surfaces — kill the live 'nykaa.comin' defect and raise landing-capture reliability | merged 2026-08-21 |

`git merge-base --is-ancestor` confirms `d10835c5` (#633 real-proof fix) is an ancestor
of `422fbd55`; the route carries the real-proof loader at the current main tip.

## Verification run (this lane, 2026-08-21)

```
$ npx vitest run tests/competitor-monitoring-category.test.ts tests/customer-claim-surface-registry.test.ts tests/design-system-ratchet.test.ts
 Test Files  3 passed (3)
      Tests  22 passed (22)
```

- Live page: `curl -L https://0509.io/competitor-monitoring` → HTTP 200;
  `<title>Competitor monitoring software | Five to Nine</title>` and the scoped
  meta description render in the served HTML.
- Live JSON-LD: `WebPage` + `FAQPage` (5 Question/Answer pairs) + `Organization` +
  `WebSite`, emitted as visible on the page.
- Live sitemap: `https://0509.io/sitemap.xml` contains the `competitor-monitoring`
  URL.
- Live proof surface: the page currently renders a real brief ("The morning brief —
  from a real watch", "Real captures from the … Ad Library", case lead Nykaa / Meta Ad
  Library, 12 public ads) — the real-proof path is genuinely live, not the empty state.
- Registry: `docs/customer-claim-surface-registry.json` records the page under
  `SEO-CANONICAL-INDEXING` (2026-08-09 assessment notes the page joining the sitemap;
  the claim honestly stays `assessed_pending_reproof` — no proof fabricated).

## Note: production renders one pre-#806 sentence (deploy drift, not this lane)

The live page still serves "…link to nykaa.comin the Meta Ad Library." (verified with a
cache-busting `?v=` request), while main tip `422fbd55` (#806, merged 2026-08-21) fixes
the separator in `app/lib/public-proof.server.ts` `buildSummary`. The fix is in the
repo's owned chain; the live lag is production deployment behind main, which is the
lane1 deploy-drift reverify workstream's item, not this packet's owned files. No code
change this lane could make would close it, and deploying production is outside this
packet's scope.

## Files

- `.lane/reports/0509-lane2-competitor-monitoring-category-already-resolved.md` —
  this evidence record (the only file touched by this lane).

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.