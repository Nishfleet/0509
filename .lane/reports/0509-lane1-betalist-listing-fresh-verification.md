# Lane 1 report — BetaList listing for Five to Nine, fresh re-verification (2026-08-15)

**Item:** Prepare a manual BetaList listing for Five to Nine
[scout 2026-08-09, risk: green] [traction] [unreviewed-by-opus]

**Status:** VERIFIED_CURRENT — the manual BetaList listing is fully prepared on
origin/main (`docs/betalist-listing-2026-08-10.md`, PR #577, re-verified by
PR #668 on 2026-08-12). This lane re-verified every live fact the listing
depends on (2026-08-15) and confirms the standing SKIPPED_PAID decision still
holds: BetaList has no free submission option, so the prepared copy stays on
file and submission is an owner decision (paid plan + personal fields).

## Verdict

The listing prep is complete, accurate, and current. All five BetaList
submission guidelines still pass (relatively new, not featured before,
technology startup, distinct landing page, visitors can sign up — verified
live on `https://betalist.com/criteria`); the paid-only requirement is
unchanged ("All submissions are paid. There is no free submission option." —
verified live on BetaList's Support/FAQ page, now at `/support`); every plan
fact in the listing copy matches `app/lib/plan-entitlements.ts` exactly; the
recommended tagline matches the live homepage SEO title verbatim; and the
listing's honesty guardrails (no Slack/WhatsApp, no unlimited monitoring, no
hardcoded currency, `0509.io` only, no beta wording) all still hold.

Nothing in this pass requires a correction to the prep document. The item is
prepared; the only remaining action is the owner's: decide whether to pay for
a BetaList submission plan and confirm the personal fields (founder name,
location, contact email) plus launch-status wording. The prep's recommended
option remains **A — submit now as "recently launched / early access"**,
with the launch-age caveat now at ~9 weeks.

## Fresh live verification (2026-08-15)

| Check | Evidence | Result |
|---|---|---|
| Submission guidelines unchanged | Live fetch of `https://betalist.com/criteria` (HTTP 200) | All six guideline rows in the prep still match verbatim; "recently launched" is still the best available fit bracket; Five to Nine passes every guideline |
| Paid-only requirement unchanged | Live fetch of BetaList Support/FAQ (HTTP 200, URL now `https://betalist.com/support`): "All submissions are paid. There is no free submission option." | SKIPPED_PAID decision stands; full automatic refund if not selected (5–10 business days) |
| Product URL live | `https://0509.io/` → HTTP 200 | Submission URL still live |
| Public search preview live | `https://0509.io/search` → HTTP 200 | No-account preview still live (supports the "visitors can sign up or get access" guideline) |
| Signup live | `https://0509.io/auth/signup` → HTTP 200 | Email magic-link signup still live |
| Tagline matches live site | `app/routes/marketing.tsx:40` — SEO title "Five to Nine \| Know when competitors change the offer" | Recommended tagline identical to live page copy |
| Plan facts current | `app/lib/plan-entitlements.ts`: free watchlists=1 + weekly digest + weekly scan; scout 3 + every_6h; starter 10 + every_3h + daily_and_weekly; agency 75 | Pricing value and both description versions match the catalog exactly (no drift since 2026-08-12 pass) |
| Meta ads tracking status current | No customer-facing beta wording on the live homepage or in the repo's marketing route since graduation commit `ac393f02` (PR #638) | Guardrail line holds; listing must not claim the product is in beta |
| Logo asset exists | `brand/five-to-nine-colored-logo.svg` in repo | Asset checklist item 1 ready to upload |
| Launch age | Production domains live since 2026-06-15 (`README.md` production note) | ~9 weeks as of 2026-08-15 — still inside "recently launched" but trending toward the weaker fit; see Launch-status wording in the prep (recommended: option A) |

## Recommendation

1. **Owner step (Nish):** decide whether to pay for a BetaList submission
   plan (plans differ by featuring speed and newsletter guarantee; full
   refund if not selected), confirm the personal fields (founder name,
   location, contact email — BetaList never publishes the email) and the
   launch-status wording (option A recommended: "recently launched — public
   early access"). The ~10-minute form fill at `https://betalist.com/submit`
   then uses `docs/betalist-listing-2026-08-10.md` field-by-field; every
   value is paste-ready.
2. If the paid tier is declined (current standing decision), no action is
   needed beyond this record: the SKIPPED_PAID status in
   `docs/venue-submissions-status-2026-08-11.md` remains current.
3. If the owner ever approves the paid tier, capture the asset-checklist
   screenshots first (homepage hero, public search preview, sample brief,
   watchlist evidence surface).

## Files

- `.lane/reports/0509-lane1-betalist-listing-fresh-verification.md` — this
  evidence record; unique to this lane. No shared report files touched; no
  product code touched; no changes to the prep document (nothing to correct).

## Proof

- Live fetches (2026-08-15): `betalist.com/criteria` 200 (guidelines
  unchanged); BetaList Support/FAQ 200 at `/support` (paid-only requirement
  unchanged); `0509.io/`, `/search`, `/auth/signup` all 200.
- Repo: `app/lib/plan-entitlements.ts` lines 121–179; `app/routes/marketing.tsx`
  line 40 (SEO title); `brand/five-to-nine-colored-logo.svg` present;
  `docs/betalist-listing-2026-08-10.md` unchanged since PR #668
  (`e7c4af1e`).
