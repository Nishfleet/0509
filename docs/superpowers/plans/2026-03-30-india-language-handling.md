# India Language Handling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `0509`'s deterministic language classification to the five-label India-first contract: `English`, `Hinglish`, `Hindi`, `Regional`, and `Unknown`, with confidence and metadata, but without OCR or translation.

**Architecture:** Keep the current `analysis.server.ts` surface, but move classification logic into a dedicated helper module so the classifier can be tested independently. The helper should combine existing ad text into one evidence sample, detect script and cue-word signals, then return a label, confidence, and reason metadata. `analysis.server.ts` should remain the place that maps classifier output into ad fields and `analysis_field` provenance.

**Tech Stack:** React Router v7 on Cloudflare Workers, TypeScript, Vitest

---

## Spec Reference

- `docs/superpowers/specs/2026-03-30-india-language-handling-design.md`

## Delivery Context

### Already Done

- Ad records already expose `languageLabel`.
- `analysis_field` already stores `language_label` with confidence and metadata support.
- The current classifier in `app/lib/analysis.server.ts` already distinguishes `English`, `Hindi`, and `Hinglish`.
- Landing-page extraction is already in place, so landing-page headline text can contribute to the evidence sample when available.

### This Slice

- Replace the current shallow heuristic with a deterministic five-label classifier.
- Add a deliberate Romanized Hindi cue-word list rather than leaving cue selection implicit.
- Attach confidence and a reason trail in `metadata`.
- Keep UI surfaces minimal and reuse the existing language display points.

### After This Slice

- OCR population for creative text
- translated text generation layered on top of OCR and existing text
- stronger agency/client-ready reporting outputs

## File Map

### Create

- `app/lib/language-classifier.ts`
- `tests/language-classifier.test.ts`

### Modify

- `app/lib/analysis.server.ts`
- `tests/analysis.test.ts`
- `app/routes/search.tsx` only if a tiny display/provenance adjustment is needed

---

## Chunk 1: Classifier Contract And Evidence Rules

### Task 1: Write failing classifier tests for the five-label contract

**Files:**
- Create: `tests/language-classifier.test.ts`

- [ ] Write focused tests for:
  - strong Devanagari sample -> `Hindi`
  - clear Romanized Hindi cues in Latin script -> `Hinglish`
  - clear English copy -> `English`
  - clear non-Devanagari Indic script -> `Regional`
  - tiny/noisy sample -> `Unknown`
- [ ] In each test, assert the returned structure includes:
  - `label`
  - `confidence`
  - `metadata`
- [ ] Run: `npm run test -- tests/language-classifier.test.ts`
- [ ] Expected: FAIL because the classifier helper does not exist yet.

### Task 2: Create the classifier helper module

**Files:**
- Create: `app/lib/language-classifier.ts`
- Test: `tests/language-classifier.test.ts`

- [ ] Create a dedicated helper that returns:
  - `label`
  - `confidence`
  - `metadata`
- [ ] Keep the helper deterministic and side-effect free.
- [ ] Do not add OCR, translation, or AI dependencies.
- [ ] Implement the five-label contract:
  - `English`
  - `Hinglish`
  - `Hindi`
  - `Regional`
  - `Unknown`
- [ ] Run: `npm run test -- tests/language-classifier.test.ts`
- [ ] Expected: initial classifier tests pass with the simplest real implementation.

### Task 3: Make the Romanized Hindi cue-word list explicit

**Files:**
- Modify: `app/lib/language-classifier.ts`
- Test: `tests/language-classifier.test.ts`

- [ ] Add a deliberate cue-word list of roughly 30-50 Romanized Hindi words commonly seen in Indian ad copy and unlikely to appear in pure English ads.
- [ ] Keep the list in-code and easy to review; do not hide it inside regex soup.
- [ ] Include representative ad-copy terms such as conversational particles, urgency words, and conversion cues, not just generic Hindi vocabulary.
- [ ] Add tests that prove the classifier uses cue evidence rather than only script detection.
- [ ] Run: `npm run test -- tests/language-classifier.test.ts`
- [ ] Expected: `Hinglish` classification is driven by deliberate evidence, not accidental keyword overlap.

---

## Chunk 2: Confidence, Metadata, And Safe Buckets

### Task 4: Add confidence behavior and reason metadata

**Files:**
- Modify: `app/lib/language-classifier.ts`
- Test: `tests/language-classifier.test.ts`

- [ ] Add confidence scoring that drops when:
  - text is short
  - evidence is conflicting
  - script detection is weak
- [ ] Add metadata fields such as:
  - `sampleLength`
  - `scriptSignals`
  - `cueMatches`
  - `decisionReason`
- [ ] Add tests that assert:
  - confident samples score higher than weak samples
  - low-signal samples land in `Unknown`
  - non-Devanagari Indic scripts land in `Regional`
- [ ] Run: `npm run test -- tests/language-classifier.test.ts`
- [ ] Expected: the classifier is explainable and conservative.

### Task 5: Implement sample-building from existing ad text

**Files:**
- Modify: `app/lib/language-classifier.ts`
- Modify: `app/lib/analysis.server.ts`
- Test: `tests/analysis.test.ts`

- [ ] Build one combined sample using existing text in this priority order:
  - preview headline
  - ad body
  - preview subhead
  - landing-page headline when available
- [ ] Keep sample construction deterministic and local to the classifier boundary.
- [ ] Add/extend tests proving that:
  - landing-page headline can contribute evidence
  - tiny ad text with no useful evidence still becomes `Unknown`
- [ ] Run: `npm run test -- tests/analysis.test.ts`
- [ ] Expected: analysis uses the new classifier input contract without changing unrelated analysis fields.

---

## Chunk 3: Wire Into Analysis And UI

### Task 6: Replace the shallow classifier in analysis.server

**Files:**
- Modify: `app/lib/analysis.server.ts`
- Test: `tests/analysis.test.ts`

- [ ] Replace the current `inferLanguageLabel(...)` logic with calls into `app/lib/language-classifier.ts`.
- [ ] Keep `analysis.server.ts` responsible for turning classifier output into product-facing fields.
- [ ] Ensure the `language_label` analysis field now uses:
  - the new five-label output
  - updated confidence
  - classifier metadata
- [ ] Do not change the destination, hook, offer, or landing-page extraction logic in this slice.
- [ ] Run: `npm run test -- tests/analysis.test.ts`
- [ ] Expected: the language field is richer, but unrelated analysis behavior is unchanged.

### Task 7: Keep the UI minimal and honest

**Files:**
- Modify: `app/routes/search.tsx` only if needed
- Test: `tests/analysis.test.ts`

- [ ] Continue showing the language label anywhere it already appears.
- [ ] Do not add a new page or dashboard surface.
- [ ] If needed, adjust the provenance rendering so the richer `language_label` field remains readable and does not expose raw metadata blobs in the UI.
- [ ] Run: `npm run typecheck`
- [ ] Expected: users see a better label, but the UI surface area stays the same.

---

## Chunk 4: Full Regression Pass

### Task 8: Verify the slice without widening scope

**Files:**
- Verify all touched files

- [ ] Run: `npm run test`
- [ ] Run: `npm run typecheck`
- [ ] Run: `npm run build`
- [ ] Smoke-check `/search` with ads that should now classify differently if such samples exist in demo/live data.
- [ ] Confirm:
  - no OCR output was added
  - no translation output was added
  - no migration file was needed
  - monitoring event types remain unchanged
- [ ] Summarize shipped work, remaining caveats, and the next slice after language handling.

---

## Notes For Execution

- Prefer `Regional` over a wrong specific label.
- Prefer `Unknown` over fake certainty.
- Keep the cue-word list explicit and reviewable.
- Do not add exact regional-language naming in this slice.
- Do not turn this into OCR or translation work.
