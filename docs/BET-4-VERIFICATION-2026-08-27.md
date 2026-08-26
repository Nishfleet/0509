# BET 4 — "No phantom changes" verification record

**Issue:** #975 — [BET 4] Adversarial fixture suite verification — 0 phantom events, 1 genuine event
**Date:** 2026-08-27
**Scope:** Verification-only (issue `rollback`: "Verification-only. If it fails, the blocking parts are not done.").

## Termination check (§3.4 BET 4, verbatim)

> Adversarial fixture suite — 500 error page, Cloudflare challenge, cookie wall,
> partially-loaded SPA, site-down-then-restored, timestamp-only edit, rotating
> banner — produces **zero** events, all recorded as `capture_failed`/`suppressed`
> with reasons; a genuine price edit in the same suite still produces one event.
> Proof = the test run plus the public rules page live.

**Result: PASS.**

## Dependencies (all closed)

| Part | Issue | State | Deliverable in main |
|---|---|---|---|
| Capture-validity gate | #953 | closed | `app/lib/capture-validity.server.ts` |
| Run-history visibility | #969 | closed | `app/lib/run-history-capture-visibility.ts` + watchlist cards |
| Public rules page | #970 | closed | `app/routes/proof.tsx` + `app/lib/capture-validity-public-rules.ts` |

## 1. The test run — event count

Suite: `tests/capture-validity-termination.test.ts` (the §3.4 termination proof,
ties the per-fixture cases in `capture-validity.test.ts`,
`capture-validity-pipeline.test.ts`, `capture-validity-corroboration.test.ts`
into one whole-suite invariant).

Command:

```
npx vitest run --configLoader runner --project node tests/capture-validity-termination.test.ts
```

Result: **17 passed (17)**.

Per-fixture outcome (pipeline-level, "produces no event for …"):

| # | Fixture | Gate decision | Events | Recorded as |
|---|---|---|---|---|
| 1 | 500 error page | reject (`landing_error_page`) | 0 | `capture_failed` |
| 2 | Cloudflare challenge | reject (`landing_challenge_page`) | 0 | `capture_failed` |
| 3 | cookie / consent wall | reject (`landing_cookie_wall`) | 0 | `capture_failed` |
| 4 | partial SPA shell | reject (`landing_partial_spa`) | 0 | `capture_failed` |
| 5 | site down (maintenance) | reject (`landing_error_page`) | 0 | `capture_failed` |
| 6 | timestamp-only edit | accept (churn-stable strip) | 0 | `suppressed` (no field diff) |
| 7 | rotating banner (ad-slot) | accept (ad-slot strip) | 0 | `suppressed` (no field diff) |

**Adversarial events: 0.** Genuine price edit (`priceText` ₹499 → ₹399):
**1 confirmed `landing_page_offer_changed` event.**

The summary case asserts the whole-suite invariant directly: 5 gate rejections,
2 gate accepts (churn-only), 0 adversarial events, 1 genuine event.

## 2. Run-history rows — failures visible with reasons

Module: `app/lib/run-history-capture-visibility.ts` (issue #969).
Wired into the watchlist UI via:
- `app/components/watchlists/recent-evidence-checks-card.tsx` (`buildRunHistoryRefusalRows`, `resolveProofCaptureRefusal`)
- `app/components/watchlists/candidate-history.tsx` (`resolveSuppressedCandidateRefusal`)

Every refusal becomes an explained run-history row with `generatesAlert: false`.
Visible row kinds:

- `capture_failed` — reason codes: `landing_error_page`, `landing_challenge_page`, `landing_cookie_wall`, `landing_partial_spa`, `landing_http_error`, `proof_capture_failed`
- `skipped_due_to_budget`, `skipped_due_to_rate_limit`, `skipped_due_to_dedupe`
- `suppressed_proof_duplicate`, `suppressed_candidate_duplicate`, `suppressed_delivery_duplicate`, `suppressed_unconfirmed_by_screenshot`, `suppressed_churn_stable`, `suppressed_ad_slot_strip`

Command:

```
npx vitest run --configLoader runner --project node tests/run-history-capture-visibility.test.ts
```

Result: **12 passed (12)** — each failure mode records a refusal row that never
alerts, and a succeeded capture / confirmed change is not listed as a refusal.

## 3. Public rules page — live

Route: `app/routes/proof.tsx` → **`/proof`** ("What we refuse to alert on").
Rules source: `app/lib/capture-validity-public-rules.ts` (`CAPTURE_VALIDITY_PUBLIC_RULES`).

Linked from:
- Marketing footer — `app/components/marketing-footer.tsx` ("Proof rules")
- Homepage — `app/routes/marketing.tsx` (proof-claim link + "What we refuse to alert on")
- Public doc shell — `app/components/public-doc-shell.tsx`

Command:

```
npx vitest run --configLoader runner --project node tests/capture-validity-public-rules.test.ts tests/proof-page-text.server.test.ts
```

Result: **passed** — the page text and rule set are asserted against the gate's
actual behaviour, so the published rules cannot drift from what the gate runs.

## Whole-suite run

```
npx vitest run --configLoader runner --project node \
  tests/capture-validity.test.ts \
  tests/capture-validity-pipeline.test.ts \
  tests/capture-validity-corroboration.test.ts \
  tests/capture-validity-termination.test.ts \
  tests/capture-validity-public-rules.test.ts \
  tests/run-history-capture-visibility.test.ts
```

Result: **6 files passed, 65 tests passed.**

## Verdict

The §3.4 BET 4 termination check passes verbatim:

- **Zero** events from the seven adversarial fixtures.
- **One** confirmed `landing_page_offer_changed` event from the genuine price edit.
- Every failure is recorded with a machine-readable reason and is visible in run
  history as a non-alerting refusal row.
- The public rules page at `/proof` is live and linked from the footer and
  homepage.

"If we send it, the page really changed" — demonstrated, not asserted.
