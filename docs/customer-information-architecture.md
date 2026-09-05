# Customer Information Architecture

Last reviewed: 2026-06-29

## Purpose

Five to Nine customer-facing views should help a buyer decide what to do next before they inspect raw evidence. Website previews, in-app digests, reports, exports, and email-ready copy should lead with the same decision ladder:

1. What changed
2. Why it matters
3. Urgency
4. Proof status
5. Source and freshness
6. Next action

Raw proof trails, metadata, source coverage, filters, and exports remain available after the summary. This keeps expert users from losing detail while keeping first-time customers from starting with internal data shape.

## Research Basis

- Nielsen Norman Group progressive disclosure: advanced or lower-frequency details should move behind the first decision layer to reduce avoidable complexity. Source: https://www.nngroup.com/articles/progressive-disclosure/
- W3C WCAG 2.2: information, relationships, sequence, headings, labels, link purpose, and contrast need to be understandable in structure, not only visually. Source: https://www.w3.org/TR/WCAG22/
- UK Government Analysis Function guidance: data products should communicate quality, uncertainty, and change plainly so users do not draw unsupported conclusions. Source: https://analysisfunction.civilservice.gov.uk/policy-store/communicating-quality-uncertainty-and-change/
- Litmus and Harvard email accessibility guidance: emails should use live text, strong contrast, simple structure, meaningful links, and layouts that still work when images are blocked. Sources: https://www.litmus.com/blog/ultimate-guide-accessible-emails and https://accessibility.huit.harvard.edu/creating-accessible-emails

## Product Rules

- Do not expose internal implementation labels as customer proof. Public labels should say "Verified proof", "Scan-spotted", "Needs review", "Proof unavailable", or "Excluded from client report".
- Do not claim exact confidence when the product does not have a customer-meaningful confidence model. Use proof status, source, and freshness instead.
- Do not lead with provider, queue, fan-out, database, or launch-gate language in public/product views.
- Reports and digests should be useful when skimmed: one highest-priority decision first, then supporting evidence.
- Exports can be denser than email or website views, but they still need customer-readable decision columns before raw proof trail/source URL details.
- Email-ready summaries should stay narrower than exports: one primary change, one reason it matters, one proof status, one source/freshness line, and one next action.

## Current Coverage

- Homepage sample proof preview leads with the decision ladder and a client-ready report preview.
- Digest detail pages show a decision summary before proof/source details, movement summary, filters, and delivery health.
- Report pages show a decision summary before proof/source coverage, glossary, insight depth, and rows.
- Dashboard recent changes include why it matters, urgency, proof status, source, freshness, and next action.
- CSV exports include decision-ready columns: what changed, why it matters, urgency, proof status, source, last seen, next action, proof trail, and source URL.
- Public markdown and `llms.txt` describe the same decision hierarchy.
- Help, Status, and Trust pages avoid stale GA-launch, internal storage, and provider-queue framing.

## Verification Notes

On 2026-06-29 this change was checked with focused tests, the full test suite, typecheck, production build, public homepage check, copy scans for stale/internal language, and browser rendering. The Codex in-app Browser successfully verified the rebuilt homepage decision hierarchy and clean console state once; its automation channel later timed out while changing mobile viewport, so mobile layout was additionally verified with the project browser wrapper.
