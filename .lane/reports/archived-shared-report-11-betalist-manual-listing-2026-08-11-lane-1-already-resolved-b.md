# BetaList manual listing (2026-08-11 lane 1) — already resolved by PR #577

**Status: already resolved; this lane records the evidence only.**

Branch: `report/lane1-betalist-listing-already-resolved`
Base: `origin/main` at `86a154b1`

## Item

- [ ] Prepare a manual BetaList listing for Five to Nine
  [scout 2026-08-09, risk: green] [traction] [unreviewed-by-grok]

## Verdict

No code change was warranted. The item is already landed on `origin/main`:

- PR #577 — `7b618cdb` "docs(launch): prepare manual BetaList listing for Five
  to Nine", merged 2026-08-11 (commit date 2026-08-11 01:10 +0530, before this
  worktree was created at 02:45). The resolving commit is an ancestor of the
  current `main` HEAD (`86a154b1`), and no later commit touches
  `docs/betalist-listing-2026-08-10.md` (single-commit file history).
- The companion SaaSHub listing (PR #607, `86a154b1`, merged 02:30) reuses the
  same canonical copy and explicitly cross-references the BetaList
  preparation, so this package is already the repo's launch-directory
  baseline rather than a throwaway draft.

## Evidence on current main

`docs/betalist-listing-2026-08-10.md` (210 lines) is a paste-ready submission
package: eligibility table against BetaList's submission guidelines,
ready-to-paste form fields (name, URL, tagline with alternates, two
description versions, five topics, freemium pricing value, launch-status
wording), honesty guardrails sourced from the repo's canonical product copy,
asset checklist, submission process notes (verified from the BetaList FAQ),
and an owner-decision list covering the personal fields the form requires
(founder name, location, contact email) plus plan tier and launch wording.

## Re-verification on this tip (2026-08-11, live checks)

Every BetaList claim in the doc was re-verified live on 2026-08-11 by this
lane; the package is still current and accurate:

- `https://betalist.com/criteria` — live; the page's five guideline groups
  (relatively new product, not featured on BetaList before, technology
  startup, distinct decent-looking landing page, visitors able to sign up)
  match the doc's eligibility table row for row, including the
  "Launched weeks ago or longer" less-suitable note the doc's
  launch-status-wording section weighs.
- All five topic URLs resolve (HTTP 200) with the exact names the doc lists:
  `/browse/data-analytics/competitive-intelligence`,
  `/browse/marketing/advertising`, `/browse/data-analytics/tracking`,
  `/browse/data-analytics/marketing-analytic`,
  `/browse/marketing/brand-monitoring`.
- Recommended tagline matches the live homepage SEO title —
  `app/routes/marketing.tsx:40` → "Five to Nine | Know when competitors
  change the offer".
- Signup claim holds: `/auth/signup` route exists (`app/routes.ts:21`,
  `app/routes/auth.signup.tsx`), so the "visitors can sign up" guideline is
  satisfied by a working route, not just a landing page.
- Logo asset `brand/five-to-nine-colored-logo.svg` present in the repo as the
  doc's asset checklist requires.
- `support@0509.io` exists (`app/lib/support.ts:13`) as a candidate for the
  form's contact-email field (owner still confirms the inbox).
- Launch-age analysis is unchanged: live in public early access since
  2026-06-15 (~8 weeks), so the doc's recommendation (option A: submit as
  "recently launched / early access", paid plan, refund if not featured)
  still holds. The one-day gap between the doc (2026-08-10) and this
  re-check does not change any field value.

## Files

- `.lane/report.md` — evidence record only; no product code touched.

---
