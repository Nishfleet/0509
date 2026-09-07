## What

Closes #1929. The moat page — `/timeline/:domain` — was absent from `https://0509.io/llms.txt`, so AI answer engines indexing the site via that map never pointed at the dated offer-state ledger. This PR extends the existing dynamic-brand-page pipeline to also list the same indexable `/timeline/:domain` URLs the sitemap emits.

**Files**

- `app/lib/public-markdown.ts` — new `llmsPageForTimelinePath(path, lastmod?)` mirroring `llmsPageForBrandPath` (single-segment `/timeline/:domain` regex, locale prefixes and multi-segment paths fall out naturally); `buildLlmsText` now accepts an optional second arg with timeline entries; the rendered output gains a `Timelines:` block right under `Pages:`; bound by the imported `SITEMAP_TIMELINE_PATH_LIMIT` from `sitemap.server` so no parallel cap is invented.
- `workers/app.ts` — `/llms.txt` branch now resolves both readers in parallel via `Promise.all([loadIndexableBrandPageEntries(env), loadIndexableTimelineEntries(env)])` so the two surfaces cannot diverge by construction. The no-D1 / no-table degradation inside `loadIndexableTimelineEntries` keeps the no-D1 / demo fallback byte-identical to today's static funnel.
- `tests/public-markdown.test.ts` — four new tests: (a) `buildLlmsText` renders the offer-timeline line with newest-capture date and skips non-qualifying paths while staying `=== LLMS_TEXT` on the empty-arg call (acceptance 5a/5b/5c); (b) exactly one blank line between the `Timelines:` block and `Current product truth:`; (c) timeline section is capped at `SITEMAP_TIMELINE_PATH_LIMIT` entries with filter-first slice order; (d) brand-page contract is unchanged when timeline entries are also passed.

## Verification

Real runs, on this branch, against the public-markdown unit suite + full node project:

```
$ npx vitest run --configLoader runner --project node tests/public-markdown.test.ts
 Test Files  1 passed (1)
      Tests  13 passed (13)

$ npx vitest run --configLoader runner --project node
 Test Files  602 passed (602)
      Tests  7173 passed (7173)

$ npx tsc -b
(no errors in app/lib/public-markdown.ts, workers/app.ts, tests/public-markdown.test.ts;
 pre-existing e2e/playwright errors in journey-* and playwright.config.ts are not
 introduced by this diff.)
```

`run-proof:` the targeted `tests/public-markdown.test.ts` suite ran on this branch and went 13/13 green; the full node project (602 files, 7173 tests) re-ran green to confirm nothing else moved.

The production parity check is captured by the existing test scaffolding — `buildLlmsText()` keeps `=== LLMS_TEXT` byte-identical so any future regression in the no-D1 / demo / missing-table fallback breaks here before reaching production. The live confirm of parity between sitemap and llms.txt requires a deploy + warm D1 read; that is left to the auto-merge arm.

## Reviewer round (pstack `reviewer-senior`, seat cursor/cursor-grok-4.6-high)

Adjudicated against `~/.pi/agent/skills/review-adjudication/SKILL.md`:

- **Act on** (warning #1, acceptance 2 wording): the offer-timeline line copy now reads "at least one dated offer state" instead of the uncounted plural "dated offer states" — the loader returns no count, and the issue's own constraint was "no unsupported claim — if the ledger has one state, say one state." Test strings updated to match.
- **Act on** (warning #2, cap stability): the `validCount` for the filter-first cap test is now `Math.min(200, SITEMAP_TIMELINE_PATH_LIMIT)` so the assertion stays stable if the shared cap moves below 200.
- **Consider** (suggestion: `SITEMAP_TIMELINE_PATH_LIMIT` import pulls `sitemap.server` into this module's graph). Noted — `public-markdown` is server-only today, and `workers/app.ts` already imports the sitemap module. No client route imports `public-markdown`. Noted, not acted.
- **Consider** (suggestion: no worker test that `/llms.txt` actually calls both loaders). Noted — a workers-side assertion would land in `tests/integration/` and expand scope; this PR stays in the unit-test lane.
- **Noted** (suggestion: ~1000-line file size). Pre-existing layout; not this diff's problem.
- **Dismissed with reason** (scope check warning): `.fleet/plan.md` and `.fleet/pr-body.md` are fleet paper (heavy-mode artifacts), not product files. Reviewer noted "Fleet paper should not block merge" — confirmed out of scope for the product review gate.
- **Acceptance check** — all six bullets PASS post-fix.

`Closes #1929`
