# India Language Handling Design

## Goal

Improve `0509`'s language classification so the product is more credible as an India-first Meta analysis workspace, without widening scope into OCR or translation.

This slice strengthens the current analysis layer by making language labels more accurate, more conservative when evidence is weak, and more explainable through confidence and metadata.

## Already Done

- `0509` already stores a language label on each ad as `ad.languageLabel`.
- `analysis_field` already stores a `language_label` row for ad-level analysis.
- The current classifier in `app/lib/analysis.server.ts` already detects:
  - `Hindi`
  - `Hinglish`
  - `English`
- The schema already supports confidence and metadata on `analysis_field`.

## Problem

The current classifier is too shallow for an India-first product.

Today it mostly relies on:

- Devanagari presence for `Hindi`
- a very short Hinglish cue-word list
- fallback to `English`

That leaves two obvious gaps:

- it cannot safely bucket other Indian-language scripts
- it is too eager to call uncertain text `English`

For `0509`, a wrong label is worse than a conservative one. We need a classifier that prefers safe buckets over fake certainty.

## Locked Scope

This slice is only about deterministic language classification.

It should:

- classify ads into:
  - `English`
  - `Hinglish`
  - `Hindi`
  - `Regional`
  - `Unknown`
- classify using text we already have
- attach confidence and a small reason trail in metadata
- keep the classification explainable and deterministic

It should **not**:

- perform OCR
- generate translated text
- identify exact regional languages beyond the safe `Regional` bucket
- add new dashboards or reporting surfaces
- introduce AI-based classification in v1

## Product Contract

### Output labels

Valid language labels for this slice are:

- `English`
- `Hinglish`
- `Hindi`
- `Regional`
- `Unknown`

### Classification principles

- prefer `Regional` over a wrong specific label
- prefer `Unknown` over fake certainty
- lower confidence when the text sample is tiny, noisy, or conflicting
- keep the result deterministic and debuggable

## Input Evidence

The classifier should build one combined text sample from content we already have, in this priority order:

1. preview headline
2. ad body
3. preview subhead
4. landing-page headline when available

The goal is to classify from the best currently available user-visible text without requiring OCR.

## Classification Contract

### `Hindi`

Use when:

- Devanagari evidence is strong enough to dominate the sample
- the text is not just a token or stray phrase

This should be the confident script-driven bucket for Hindi written in Devanagari.

### `Hinglish`

Use when:

- Latin script dominates the sample
- but there is strong Romanized Hindi evidence

Examples of cue types:

- Hindi-in-Roman words such as:
  - `bhi`
  - `abhi`
  - `sirf`
  - `jaldi`
  - `ghar`
  - `wali`
  - `kar`
  - `karo`
  - `lelo`
  - `hai`
  - `hain`
- clearly mixed India conversational offer phrasing

### `English`

Use when:

- Latin script dominates
- Hindi/Hinglish evidence is weak or absent
- there is enough text to make a safe call

### `Regional`

Use when:

- there is strong evidence of another Indic script such as Tamil, Bengali, Telugu, Kannada, Malayalam, Gujarati, Gurmukhi, or Odia
- but we are intentionally not naming the exact language in this slice

This is a safety bucket, not a failure state.

### `Unknown`

Use when:

- the text sample is too short
- the sample is mostly emojis, numbers, or brand names
- the evidence is conflicting and low-confidence

## Confidence And Metadata

The `language_label` analysis field should keep using the existing `analysis_field` model, but with stronger metadata:

- `fieldValue`: one of the five allowed labels
- `confidence`: numeric score
- `metadata`: small reason trail

Suggested metadata shape:

- `sampleLength`
- `scriptSignals`
- `cueMatches`
- `decisionReason`

Example ideas:

- `scriptSignals: { devanagari: 12, latin: 48, tamil: 0 }`
- `cueMatches: ["bhi", "sirf", "hai"]`
- `decisionReason: "latin_with_hinglish_cues"`

This metadata is primarily for debugging and future classifier tuning. It does not need to be fully rendered in the UI in this slice.

## Data Model

No migration is required.

We continue to use:

- `ad.languageLabel` as the main display label
- the existing `analysis_field` row with `field_key = 'language_label'`

Changes are behavioral:

- richer label set
- richer confidence behavior
- richer metadata

## Implementation Shape

### Files likely to change

- `app/lib/analysis.server.ts`
- `app/lib/types.ts` only if a narrow helper type improves clarity
- `tests/` for classifier coverage
- `app/routes/search.tsx` only if we lightly improve how provenance is described

### Recommended helper split

Create a small dedicated classifier helper instead of leaving all logic embedded in `analysis.server.ts`.

Suggested helper:

- `app/lib/language-classifier.ts`

Responsibilities:

- combine text sample
- detect script evidence
- score cue-word evidence
- return:
  - `label`
  - `confidence`
  - `metadata`

Then `analysis.server.ts` can remain the place that converts classifier output into product-facing `AnalysisFieldInput`.

## UI Surface

Keep UI changes minimal.

### Search results and detail

Continue showing the language label where it already exists.

No new page is needed.

### Provenance

Keep the provenance row for `language_label`, but make sure it reflects the new classified value and confidence internally.

Full metadata rendering is optional in this slice; storing it cleanly matters more than displaying it immediately.

## Testing

### Unit coverage

Add tests covering:

- strong Devanagari -> `Hindi`
- strong Romanized Hindi cues -> `Hinglish`
- clear English copy -> `English`
- clear non-Devanagari Indic script -> `Regional`
- tiny/noisy sample -> `Unknown`
- conflicting low-signal sample -> lower confidence and safe bucket

### Regression expectations

- no OCR dependency
- no translation output
- no new migrations
- no changes to monitoring event types

## Acceptance Criteria

- Ads can now classify into `English`, `Hinglish`, `Hindi`, `Regional`, or `Unknown`.
- The classifier is deterministic and explainable.
- `language_label` carries confidence and a useful metadata reason trail.
- Weak evidence prefers `Regional` or `Unknown` instead of incorrect certainty.
- No OCR or translation functionality is introduced in this slice.

## After This Slice

Once language handling is stronger, the next analysis-depth order should be:

1. OCR population for creative text
2. translated text generation layered on top of OCR and existing text
3. stronger agency/client-ready reporting outputs

That order keeps transformation features downstream of a cleaner classification base.
