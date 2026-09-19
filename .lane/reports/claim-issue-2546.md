# Lane evidence — claim/issue-2546, reviewer round (2026-09-20)

## Scope

Requested review of `origin/main...HEAD` (bc552cf8, 890de1d1) against Nishfleet/0509#2546
acceptance and the repo tests. Engine: project reviewer agent (senior code-review role).
Round 1 of 3 per the review-adjudication doctrine.

## Reviewer verdict

- Requirement 1 (rewrite the 7 named surfaces to the audited capture-includes-one
  phrasing): PASS. auth.signup.tsx named line no longer exists on main (rewritten by
  #3177 to claim-free copy); correct treatment was gate-listing the file, which the
  branch does. Byte-level match verified between the ads.$domain headline stat and
  tests/ads-brand-page-what-changed.test.tsx expectation.
- Requirement 2 (gate banned list + surfaces): PASS with one gate gap (see findings).
- Requirement 3 (no weakened claim tests): PASS — assertions track the new honest copy;
  negative guards retained.

## Findings → adjudication

Act on (fixed this round, commit "close reviewer-found revert paths"):
1. reviewer: banned phrase `source link, and screenshot proof` missed compare.tsx's old
   row (`...page text, source link, and screenshot`, no "proof") — a bare revert would
   bypass the gate. Verified raw; added banned `page text, source link, and screenshot`.
2. adjudicator (own verification): `source link, and screenshot proof` also misses
   compare.meta-ad-library.tsx:89's old bare `screenshot proof`. Added banned
   `screenshot proof` (verified: zero occurrences in listed surfaces — remaining hits
   are app/data/compare/meta-ad-library-citations.json:31 (not listed) and two code
   comments).
3. documentation: comment added above the banned list fixing the class boundary
   (product promises only; reader instructions, third-party characterizations, and
   code comments are deliberately not banned).

Dismissed:
- reviewer's `app/components/trust.tsx:64-65` warning — hallucinated: no such file;
  string `saved screenshots` occurs nowhere in `app/` (grep-verified).

Filed as NEW issues (outside #2546 files: scope, same class):
- meta-ad-library citation claim card still renders `screenshot proof`
  (app/data/compare/meta-ad-library-citations.json:31; guarded live by
  tests/compare-meta-ad-library.route.test.ts:63).
- /llms-full.txt description (app/lib/public-markdown.ts:154) and feed header string
  (app/lib/llms-full.server.ts, buildLlmsFullText header) still say "each state cites
  its screenshot…" although the feed honestly degrades per state to "no screenshot"
  (feed body is compliant; header/description are the residual overclaim).

Consider (named open questions, no action):
- phrase-convergence: ads.$domain/compare F9 rows say "the link" where canonical
  audited copy says "the original link"/"the original source link"; meaning unchanged.
- JA term 撮影 vs キャプチャ for "capture" in sneaker-resale-copy.ts; meaning survives.

Noted:
- delivery-account-emails.server.ts:735 keeps old word order but is runtime-gated on
  proofCaptureSucceeded — truthful.
- ads headline stat is fully gated behind hasHeadline today (#1897 architecture);
  the claim class matters for future landing_page_* events.

## Verification (real runs)

- `npx vitest run --configLoader runner --project node --changed origin/main`
  → 138 files / 1753 tests, all PASS.
- Targeted re-run after remediation: `npx vitest run --configLoader runner --project
  node tests/customer-claim-audit-table.test.ts tests/compare-meta-ad-library.route.test.ts
  tests/ads-brand-page-what-changed.test.tsx` → 3 files / 20 tests, all PASS.
