# Lane 3 — Homepage hero sample card leaks raw markdown in the "Brief export" block

Item: `*Nykaa changed the routine bundle angle*` leaking raw markdown into the
homepage "Brief export" sample card.

## Verdict: already resolved on main; no code change required

The defect was fixed in two steps, both merged to `main` before this lane ran:

1. **PR #692** (`aa019c47`, "fix(home): render brief-export markdown instead of
   leaking raw syntax") — the homepage "Brief export" block rendered the
   digest-markdown fixture verbatim, so `*emphasis*` asterisks leaked into
   visible copy. The fix rendered the small supported markdown subset via
   `renderDigestMarkdownPreview` and added regression tests
   (`tests/marketing-sample-brief.test.tsx`).
2. **PR #633** (`d261d4a0`, "feat(proof): real proof on public surfaces — kill
   sample/illustrative demos") — the sample fixture was deleted entirely
   (`app/lib/demo-proof.ts` removed). The homepage now renders the real proof
   brief from `app/lib/public-proof.server.ts` (cache-only reads of the
   discovery cache), with an honest "No live proof right now" empty state.
   `renderDigestMarkdownPreview` and the `demoProof.exports.digestMarkdown`
   path are gone from `app/routes/marketing.tsx`.
3. **PR #806** (`422fbd55`, current `main` HEAD) — fixed the adjacent
   `nykaa.comin` sentence-glue defect and added `tests/public-proof-summary.test.ts`.

## Evidence

- Current `main` HEAD: `422fbd55`.
- `app/routes/marketing.tsx` "Brief export" block (lines 942–947) renders
  structured fields only — `proofBrief.decision.subject`, `priority`,
  `adCount`, `fetchedAt` — no markdown string is ever interpolated.
- `grep` across `app/` for `*Nykaa changed the routine bundle angle*`,
  `digestMarkdown`, `renderDigestMarkdownPreview`, `demoProof` finds **no**
  production references. The only remaining occurrence of the old fixture
  string is the regression-test guard itself
  (`tests/marketing-rebuild.test.ts:209`), which asserts it never returns.
- Live production check: fetched `https://0509.io/` — the "Brief export"
  block renders `12 of 12 cached ads are active on record / Priority: Review
  before the next campaign refresh / Proof: 12 real captures —
  2026-08-21T02:41:38.989Z`. No asterisks, no raw markdown, no sample card.
- Guard test `never injects raw digest-markdown syntax into the homepage
  markup` passes (plus the full marketing/proof suite):
  - `tests/marketing-rebuild.test.ts` — 25 passed
  - `tests/marketing-proof-brief.test.tsx` — 7 passed
  - `tests/public-proof-summary.test.ts` — 3 passed
- The remaining `sample` references in `app/` are CSS variants
  (`f9-longevity-pill.is-sample`), signed-in search result labels ("Sample"
  badge for demo-sourced rows), and internal sample-data helpers — none render
  into the homepage hero or "Brief export" block.

## Files changed by this lane

- `.lane/reports/0509-lane3-hero-brief-export-markdown-leak-already-resolved.md`
  — this evidence report (lane-unique path).

No product code was changed because the item is already resolved on `main`.
