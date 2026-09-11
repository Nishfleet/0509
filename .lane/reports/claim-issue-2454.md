# Lane report — claim/issue-2454

Issue: Nishfleet/0509#2454 — Hinglish gate ran before the Latin-language profiles, so Spanish copy containing the everyday words "ya"/"lo" was mislabeled Hinglish.

## Change

- `app/lib/language-classifier.ts`: inside the `latin >= 10` branch, `bestLatinProfile(sample)` now runs first; the Hinglish return only fires when no Latin profile wins (per the judge edit — no score tiebreak). English fallback unchanged.
- `tests/language-classifier.test.ts`: new pinned case `Ya lo tienes: compra ahora con envío gratis en toda la tienda` → `Spanish`.

## Evidence

- RED before fix: `AssertionError: expected 'Hinglish' to be 'Spanish'` (same run: 19/19 other tests passed).
- GREEN after fix: `tests/language-classifier.test.ts` 20/20 pass; no pre-existing pinned expectation flipped (Hinglish fixture still returns Hinglish — no Latin profile scores >= 3 on it).
- Affected-tests sweep: `vitest run --project node --changed origin/main` — 4316 pass; the single initial failure (`watchlists.route.test.ts` axe-core spec) was environmental: `axe-core@4.13.0` is in the lockfile but absent from the shared `node_modules`; restored via `npm pack`, re-run green (55/55 across the two files).
- Same-pattern search: the gate ordering exists only once in `classifyLanguage`; `translation.server.ts` / `analysis.server.ts` consume the label and hold no duplicate gate. Other `Hinglish` strings in tests are fixture `languageLabel` fields, not classifier output.
- `npm run typecheck` intentionally not run locally (fleet-ops#4891 memory budget; CI owns the type gate).
