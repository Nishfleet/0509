# Landing Page Extraction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich landing-page snapshots with `cta_text`, `price_text`, and `form_present`, then surface those signals in the search detail UI without adding new monitoring event types.

**Architecture:** Build on the existing fetch-first landing-page capture flow. Add a small parser helper dedicated to landing-page signals, extend the in-memory snapshot type, persist the richer snapshot into the existing `landing_page_snapshot` columns plus `analysis_field` rows with `scope_type = 'landing_page'`, and expand the existing search detail card to render the new fields honestly.

**Tech Stack:** React Router v7 on Cloudflare Workers, TypeScript, D1, R2, Vitest

---

## Spec Reference

- `docs/superpowers/specs/2026-03-30-landing-page-extraction-design.md`

## Delivery Context

### Already Done

- Landing-page snapshots are already captured for:
  - selected ads in search
  - watchlist monitoring scans
- The `landing_page_snapshot` schema already includes:
  - `cta_text`
  - `price_text`
  - `form_present`
- `analysis_field` already exists and supports `scope_type = 'landing_page'`.
- Monitoring currently diffs only landing-page URL and normalized headline, and that boundary stays unchanged.

### This Slice

- Extract `cta_text`, `price_text`, and `form_present` during fetch-based landing-page capture
- Persist those values into `landing_page_snapshot`
- Write matching `analysis_field` provenance rows for landing-page scope
- Show the richer landing-page intelligence in the selected-ad search detail card

### After This Slice

- Better India-language handling
- OCR and translated text population
- Stronger agency/client-ready reporting outputs

## File Map

### Create

- `app/lib/landing-page-signals.server.ts`
- `tests/landing-page-signals.test.ts`
- `tests/data.server.test.ts`

### Modify

- `app/lib/types.ts`
- `app/lib/landing-pages.server.ts`
- `app/lib/data.server.ts`
- `app/lib/analysis.server.ts`
- `app/routes/search.tsx`

---

## Chunk 1: Parser And Snapshot Contract

### Task 1: Extend the snapshot type for richer LP signals

**Files:**
- Modify: `app/lib/types.ts`
- Test: `tests/landing-page-signals.test.ts`

- [ ] Add `ctaText?: string | null`, `priceText?: string | null`, and `formPresent?: boolean | null` to `LandingPageSnapshotData`.
- [ ] Keep the current fields unchanged so existing capture/monitoring code still compiles.
- [ ] Do not add any new watch event types or monitoring-specific types.
- [ ] Run: `npm run typecheck`
- [ ] Expected: passes with only type updates and no route breakage.

### Task 2: Create the landing-page signal parser helper

**Files:**
- Create: `app/lib/landing-page-signals.server.ts`
- Test: `tests/landing-page-signals.test.ts`

- [ ] Create a dedicated helper module instead of growing `app/lib/landing-pages.server.ts` into a parser file.
- [ ] Add an extractor version constant set to exactly `lp-signals-v1`.
- [ ] Implement a pure parser entrypoint that accepts HTML and returns:
  - `ctaText`
  - `priceText`
  - `formPresent`
  - optional parser metadata if needed
- [ ] Keep the parser deterministic and fetch-path-friendly. No external services, no OCR, no translation.
- [ ] Use detection rules from the approved spec:
  - CTA from buttons, submit inputs, or high-signal action links
  - price/offer from common commerce snippets such as `₹999`, `Rs 699`, `50% off`, `Starting at ₹499`, `Buy 2 Get 1`
  - form detection from real `<form>` tags or strong lead signals
- [ ] Return `null` for signals that are not confidently detected instead of inventing placeholders.
- [ ] Write parser tests that cover:
  - CTA extraction from `<button>` and `<input type="submit">`
  - price extraction for India-style currency and percentage offers
  - `formPresent = true` for real forms
  - `formPresent = false` when fetchable HTML lacks form signals
- [ ] Run: `npm run test -- tests/landing-page-signals.test.ts`
- [ ] Expected: parser tests pass and no persistence code is required yet.

---

## Chunk 2: Capture, Persistence, And Provenance

### Task 3: Wire signal extraction into landing-page capture

**Files:**
- Modify: `app/lib/landing-pages.server.ts`
- Modify: `app/lib/landing-page-signals.server.ts`
- Test: `tests/landing-page-signals.test.ts`

- [ ] Import the parser helper into `captureLandingPageSnapshot(...)`.
- [ ] After successful fetch and HTML read, parse the richer landing-page signals before building the snapshot object.
- [ ] Populate `ctaText`, `priceText`, and `formPresent` on the returned snapshot.
- [ ] Keep fetch-first headline logic unchanged.
- [ ] Keep the current fallback semantics:
  - if fetch fails and the browser-render placeholder path is used, leave the richer signals unavailable
  - do not synthesize fake CTA/price/form values in fallback mode
- [ ] Run: `npm run test -- tests/landing-page-signals.test.ts`
- [ ] Expected: fetch-path extraction stays deterministic and fallback still returns an honest minimal snapshot.

### Task 4: Persist richer snapshot fields into D1

**Files:**
- Modify: `app/lib/data.server.ts`
- Test: `tests/data.server.test.ts`

- [ ] Update `createLandingPageSnapshot(...)` so it writes:
  - `cta_text`
  - `price_text`
  - `form_present`
  instead of hardcoded `NULL` values.
- [ ] Convert `formPresent` into the existing integer storage convention:
  - `1` for true
  - `0` for false
  - `NULL` for unavailable
- [ ] Keep `ocr_text` and `translated_text` untouched and `NULL`.
- [ ] Add a focused test with a fake D1 `prepare().bind().run()` chain that verifies the bound values include the richer snapshot fields.
- [ ] Run: `npm run test -- tests/data.server.test.ts`
- [ ] Expected: persistence test proves the existing schema is sufficient and no migration is needed.

### Task 5: Write landing-page provenance rows

**Files:**
- Modify: `app/lib/analysis.server.ts`
- Modify: `app/lib/data.server.ts`
- Test: `tests/data.server.test.ts`

- [ ] Add a helper in `app/lib/analysis.server.ts` for landing-page-scoped analysis fields.
- [ ] Use extractor version `lp-signals-v1` for:
  - `cta_text`
  - `price_text`
  - `form_present`
- [ ] Use `provenance_source = 'landing_page_fetch'` for fetch-extracted fields.
- [ ] In `createLandingPageSnapshot(...)`, call `replaceAnalysisFields(env, "landing_page", snapshotId, ...)` after inserting the snapshot row.
- [ ] Store only fields that have meaningful values:
  - string fields when detected
  - `form_present` when true or false is known
- [ ] Add/extend a test to verify the landing-page analysis fields are written with:
  - `scope_type = 'landing_page'`
  - expected field keys
  - extractor version `lp-signals-v1`
- [ ] Run: `npm run test -- tests/data.server.test.ts`
- [ ] Expected: landing-page provenance exists without changing ad-level or observation-level field contracts.

---

## Chunk 3: Search UI And Regression Pass

### Task 6: Expand the search detail card

**Files:**
- Modify: `app/routes/search.tsx`

- [ ] Expand the existing `Landing page intelligence` card to render:
  - headline
  - primary CTA
  - visible price/offer
  - form present
  - capture method
- [ ] Use explicit capture labels:
  - `Fetch capture`
  - `Browser-rendered`
  - `Capture unavailable`
- [ ] Render missing field values as `Not detected` when capture succeeded but the parser found nothing.
- [ ] Keep the landing-page URL link behavior unchanged.
- [ ] Do not add a new page, new tab, or a separate workspace surface in this slice.
- [ ] Run: `npm run typecheck`
- [ ] Expected: selected-ad detail remains the only UI that changes.

### Task 7: Expose the new signals in analysis provenance

**Files:**
- Modify: `app/routes/search.tsx`
- Modify: `app/lib/analysis.server.ts` if needed

- [ ] Ensure the visible provenance list includes the landing-page signals when present.
- [ ] Do not duplicate misleading empty rows for values that were never detected.
- [ ] Keep the current provenance format:
  - field key
  - field value
  - provenance source
  - extractor version
- [ ] Run: `npm run typecheck`
- [ ] Expected: users can tell which values came from fetch-based landing-page extraction.

### Task 8: Full regression pass

**Files:**
- Verify all touched files

- [ ] Run: `npm run test`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run build`
- [ ] Smoke-check the selected-ad search detail flow on a page with a landing-page URL.
- [ ] Confirm monitoring tests still only cover:
  - `landing_page_url_changed`
  - `landing_page_headline_changed`
- [ ] Confirm no migration file was needed.
- [ ] Summarize shipped work, caveats, and the next analysis-depth slice.

---

## Notes For Execution

- Do not widen this into browser-render rollout, OCR, translation, or new diff event types.
- Do not enrich every search result row.
- Keep this slice centered on the existing trigger rule:
  - inspect
  - save
  - monitor
- If a later slice adds `cta_changed` or `offer_changed`, it should build on the data captured here without requiring a schema migration.
