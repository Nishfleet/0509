## Why

The `/docs` "Understand the proof labels" section is the trust reference a buyer reads to judge evidence. It named the "likely" tier "Related or broader" (a name the UI never shows), invented a "Cached" proof tier (it is a freshness state, not a tier), and never documented "Unmatched" — the label a user sees most often. The docs were wrong, not the UI.

## Scope

- `app/routes/docs.tsx`: rename the `Related or broader` dt term to `Likely`; add an `Unmatched` entry with the UI confidence note; move `Cached` out of the proof-tier list into the troubleshooting block where capture freshness is discussed. `Verified` and `Sample` unchanged. The `id="proof-labels"` anchor and `<PublicDocBlock>` structure are preserved.
- `tests/public-doc-routes.test.ts`: add a test pinning the rendered proof-label names to exactly what the `/search` UI shows (Verified / Likely / Unmatched / Sample), asserting the old names are gone and the freshness line is documented in troubleshooting.

## Verification

- `npx vitest run --configLoader runner --project node tests/public-doc-routes.test.ts` → 1 file, 6 tests passed (includes the new issue-1462 test).
- `npx vitest run --configLoader runner --project node` → 567 files, 6796 tests passed.
- `grep -c 'Related or broader' app/routes/docs.tsx` → 0; `grep -c '<dt>Cached</dt>' app/routes/docs.tsx` → 0; `grep -c '<dt>Likely</dt>\|<dt>Unmatched</dt>' app/routes/docs.tsx` → 2.

run-proof: vitest node project 6796/6796 passed; targeted public-doc-routes 6/6 passed.

net-positive-because: the +31 net lines are a docs copy fix plus a snapshot test pinning the rendered proof-label strings; the test is the durable guard that keeps the docs and UI label names reconciled.

Closes #1462
