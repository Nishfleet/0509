# Landing Page Extraction Design

## Goal

Make `0509`'s analysis layer materially more useful by extracting structured landing-page signals for ads that matter, without widening scope into OCR, translation, or new monitoring event types.

This slice improves both halves of the product:

- `analysis`: better understanding of what the destination page is asking a visitor to do
- `monitoring`: richer landing-page state captured now, ready for future diffing later

## Already Done

- The Cloudflare-native rebuild is already in place on React Router v7 + Workers.
- The public search flow already captures a landing-page snapshot for the selected ad when a landing-page URL exists.
- Monitoring already captures landing-page snapshots during watchlist scans.
- The D1 schema already has room for richer landing-page fields in `landing_page_snapshot`:
  - `cta_text`
  - `price_text`
  - `form_present`
  - `ocr_text`
  - `translated_text`
- `analysis_field` already exists as the reusable provenance model for extracted fields.

## Problem

The current landing-page intelligence layer is still too shallow.

Today `0509` can tell a user:

- the landing-page URL
- the landing-page headline
- whether the page was captured via fetch or fallback

That is useful, but incomplete. For competitive analysis, the more important questions are often:

- what is the page asking the user to do?
- is there a visible price or offer?
- is this page clearly trying to collect a lead?

Those are higher-signal business answers than headline text alone.

## Locked Scope

This slice adds richer landing-page extraction for:

- the selected ad in search
- ads that are saved/bookmarked into collections
- ads processed during watchlist scans

This slice does **not** enrich every search result row.

That trigger rule is intentional. We only spend fetch/parsing budget when either:

- a user has signaled interest by inspecting or saving an ad, or
- the system has signaled importance by monitoring the ad

## Out Of Scope

- OCR population
- translated text population
- browser-render rollout beyond the current fallback placeholder path
- new monitoring event types such as `landing_page_cta_changed` or `landing_page_offer_changed`
- separate landing-page detail pages
- export/report redesign
- multi-platform support

## Product Contract

### Structured fields

This slice adds three extracted landing-page signals:

- `cta_text`
- `price_text`
- `form_present`

These fields should be captured during the existing landing-page snapshot flow and stored on the snapshot itself.

### Trigger rule

Extraction only runs when a snapshot is already being captured:

- selected ad inspection in search
- save-to-collection flow
- watchlist monitoring scans

No eager enrichment of search result grids.

### Monitoring boundary

Monitoring continues to diff only the existing two landing-page change types:

- `landing_page_url_changed`
- `landing_page_headline_changed`

We capture richer fields now, but do **not** emit new watch event types in this slice.

## Data Model

### Reuse existing schema

No migration is required for this slice.

The existing `landing_page_snapshot` table already supports the new fields:

- `cta_text TEXT`
- `price_text TEXT`
- `form_present INTEGER`

### Provenance model

The new landing-page signals should also be written into `analysis_field` with:

- `scope_type = 'landing_page'`
- `field_key` values:
  - `cta_text`
  - `price_text`
  - `form_present`
- `provenance_source = 'landing_page_fetch'` for the fetch path
- the current extractor version for traceability

This keeps the extracted fields queryable in a way that matches the rest of the analysis model, while still preserving first-class snapshot columns for direct use.

### Type contract

`LandingPageSnapshotData` should be extended to carry:

- `ctaText?: string | null`
- `priceText?: string | null`
- `formPresent?: boolean | null`

The distinction matters:

- string value means detected
- `null` means capture happened but signal was not detected or not confidently available
- for UI output, `null` should usually render as `Not detected`

## Extraction Rules

### CTA text

Goal: capture the best visible action phrase on the page.

Prioritize text from:

- `<button>`
- `<input type="submit">`
- obvious commerce / lead links with button-like language

Prefer high-signal phrases such as:

- `buy now`
- `shop now`
- `add to cart`
- `get offer`
- `claim deal`
- `book demo`
- `whatsapp us`
- `get started`
- `submit`

If multiple candidates exist, prefer the one that is:

1. most action-oriented
2. shortest and clearest
3. most likely to represent the primary conversion action

### Price text

Goal: capture the strongest visible price or offer snippet, not a normalized pricing model.

Examples of valid extracted values:

- `₹999`
- `Rs 699`
- `50% off`
- `Starting at ₹499`
- `Buy 2 Get 1`

Prefer the most prominent commerce-like phrase rather than trying to capture every numeric mention on the page.

### Form present

Goal: detect whether the page is clearly driving a lead capture or input flow.

Rules:

- `true` if the page contains a real `<form>` or strong lead signals such as named contact inputs plus a submit action
- `false` if the page fetched successfully and those signals are absent
- `null` only when capture is unavailable or the extraction path cannot evaluate the page meaningfully

## Capture Method Semantics

The UI should make capture method explicit from day one:

- `Fetch capture`
- `Browser-rendered`
- `Capture unavailable`

That avoids confusion later when some pages become richer under a future browser-render path.

## Implementation Shape

### Files likely to change

- `app/lib/types.ts`
- `app/lib/landing-pages.server.ts`
- `app/lib/data.server.ts`
- `app/lib/analysis.server.ts`
- `app/routes/search.tsx`
- `tests/` for new parser and persistence coverage

### Recommended helper split

Keep responsibilities narrow:

- `app/lib/landing-pages.server.ts`
  - fetches page HTML
  - handles fallback behavior
  - persists artifact HTML to R2
  - coordinates extraction
- new helper module, likely `app/lib/landing-page-signals.server.ts`
  - parses HTML for `cta_text`, `price_text`, and `form_present`
  - keeps extraction logic isolated from fetch/orchestration code
- `app/lib/data.server.ts`
  - persists the richer snapshot columns
  - writes matching `analysis_field` rows for provenance

## UI Surface

This slice only expands the existing selected-ad detail experience in search.

### Search detail card

In the existing `Landing page intelligence` card, show:

- `Headline`
- `Primary CTA`
- `Visible price/offer`
- `Form present`
- `Capture method`

Rendering rules:

- show extracted value when present
- show `Not detected` for missing CTA/price/form values when capture succeeded
- show `Capture unavailable` when snapshot capture itself is unavailable

### Provenance

The existing analysis provenance list should include the new landing-page fields so the user can see:

- where the value came from
- which extractor version produced it

## Save And Monitoring Behavior

### Save flow

When a selected ad is saved to a collection, the enriched landing-page snapshot should remain part of the saved ad payload automatically through the existing serialized selected-ad flow.

### Watchlist scans

Watchlist runs should continue to capture landing-page snapshots as they do today, but now those snapshots should persist the richer structured fields too.

No new monitoring event types are added in this slice.

## Error Handling

- If landing-page capture succeeds but a specific field is not found, store the field as absent and render `Not detected`.
- If landing-page capture fails entirely, preserve today’s behavior and do not invent values.
- If the current browser-render fallback placeholder is used, keep the capture method honest and leave `cta_text`, `price_text`, and `form_present` unavailable.

## Testing

### Unit tests

Add parser-focused tests for:

- CTA extraction from buttons and submit inputs
- price/offer extraction from common India-style commerce text
- form detection for both true and false cases

### Persistence tests

Add tests covering:

- richer landing-page snapshot values persist to `landing_page_snapshot`
- matching `analysis_field` rows are written with `scope_type = 'landing_page'`
- extractor version and provenance are preserved

### Regression expectations

- existing monitoring diff tests remain unchanged
- no new watch event types are introduced
- search still works when no landing page exists

## Acceptance Criteria

- No migration is required.
- Inspecting a selected ad with a fetchable landing page can show `cta_text`, `price_text`, and `form_present` when detectable.
- Missing signals render as `Not detected`, not silent blanks.
- Capture method is explicit and honest in the UI.
- Saving an ad preserves the enriched landing-page snapshot.
- Watchlist scans persist the richer landing-page snapshot fields.
- No new landing-page watch event types are emitted in this slice.

## After This Slice

Once richer landing-page extraction ships, the next analysis-depth order should be:

1. better India-language handling
2. OCR and translated text population
3. stronger agency/client-ready reporting outputs

That order keeps us improving the intelligence layer before widening workflow chrome.
