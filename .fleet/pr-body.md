## Land the BET 8 switch-page acceptance gate (issue #1896)

The switch landing pages themselves — `/switch/magicbrief`, `/switch/panoramata`, `/switch/visualping` — were already shipped by #1117 (merged via PR #1134, 2026-08-26). Issue #1896 re-filed the same acceptance from the weekly review; this PR lands the one acceptance bit the shipped suite did not yet pin down and closes the duplicate.

### What changed

- **`tests/switch-pages.route.test.ts`**: new `it.each(SWITCH_SLUGS)` block asserting each switch page renders its "Full product comparison" cross-link to the `/compare/*` sibling named in the issue's `product_surface` (`relatedComparePath`), and that the target compare route file exists (no dead href). The `relatedComparePath` link is rendered by `app/components/switch-landing.tsx` but was asserted nowhere; the `/switch/*` surface and the `/compare/*` surface are one funnel, so the cross-link is the tie between them.
- **Acceptance-contract header** on the same suite, mapping the file to issue #1896's criteria (routes exist, in sitemap, WebPage + FAQPage JSON-LD, verified-complaint anchor, free preview not demo form, compare cross-link) so a future duplicate of this work can be closed against a machine-checkable contract.

### Acceptance verification (live, 2026-09-07)

| criterion | magicbrief | panoramata | visualping |
|---|---|---|---|
| route returns 200 (`https://0509.io/switch/<slug>`) | 200 | 200 | 200 |
| listed in `sitemap.xml` | yes | yes | yes |
| structured data (WebPage + FAQPage + BreadcrumbList JSON-LD) | 3 blocks | 3 blocks | 3 blocks |
| ends in free `/search` preview — no `<form>`, no email input | no form | no form | no form |
| anchored on verified public complaint, source still live | MagicBrief FAQ (shutdown 31 Jul 2026) 200 | panoramata.co/track/website-changes 200 | visualping.io blog (false positives) 200 |

### Verification

```
$ npx vitest run --configLoader runner --project node tests/switch-pages.route.test.ts
Test Files  1 passed (1)
     Tests  22 passed (22)   # 19 pre-existing + 3 new cross-link assertions

$ npx vitest run --configLoader runner --project node
Test Files  598 passed (598)
     Tests  7123 passed (7123)

$ npx vitest run --configLoader runner --project workers
Test Files  31 passed (31)
     Tests  156 passed (156)

$ sgscan --base origin/main
No new security findings.
```

`npm run typecheck` reports only pre-existing errors in `e2e/*.spec.ts` and `playwright.config.ts` (files untouched by this PR; reproduced on the base commit — same class as noted in PR #1134).

run-proof: `npx vitest run --configLoader runner --project node` → 598 files / 7123 tests passed; `--project workers` → 31 files / 156 tests passed; `sgscan --base origin/main` → no new findings; live `curl` of all three `/switch/*` routes + `sitemap.xml` + JSON-LD blocks verified 2026-09-07.

research: no external libraries or APIs introduced; the assertion reuses the suite's existing render-to-static-markup machinery and the shipped `relatedComparePath` field.

help-first: no new `bin/` files or CLI tools added.

net-positive-because: test-only change that pins the switch→compare cross-link (the issue's `product_surface` tie) and documents the acceptance contract, enabling the fleet to close duplicate filings of this already-shipped work.

loose-ends: none — the switch pages shipped under #1117 (PR #1134); Search Console impression monitoring remains with Nish per the original delivery note.

### Reviewer round

Reviewer seat: `commandcode<TAB>meta/muse-spark-1.2-contributor` (resolved via `find_senior_seat`; `fleet-review-arm-check` exit 0).

- **Act on** — the cross-link gate accepted any existing `/compare/*` target instead of the exact sibling named in the issue's `product_surface`; pinned a per-slug expected map (`magicbrief → /compare/magicbrief`, `panoramata → /compare/panoramata`, `visualping → /compare/visualping-ad-libraries`, the #1481 canonical) and asserted equality. (committed as the follow-up commit)
- **Consider** — the URL→file derivation assumes the flat-route convention; added a one-line comment stating the assumption so a future convention change doesn't silently break the suite.
- **Noted** — the acceptance doc comment describes guarantees enforced by the whole suite; that is the intended contract mapping for duplicate closing.
- **Dismissed-with-reason** — none.

Closes #1896
