# Manual SaaSHub listing for Five to Nine — already prepared; this lane records the evidence only

**Status: already prepared on `origin/main`; this lane adds no product change.**

Branch: `lane1/saashub-listing-already-prepared`
Base: `origin/main` at `7960292d` (#737)

## Item

- [ ] Prepare a manual SaaSHub listing for Five to Nine
  [scout 2026-08-09, risk: green] [traction] [unreviewed-by-opus]

## Verdict

The manual SaaSHub listing preparation is already complete on `origin/main`.
The canonical paste-ready document is `docs/saashub-listing-2026-08-11.md`,
created 2026-08-11 and re-verified 2026-08-12 (PR #667, commit `26301615`),
with the older `docs/saashub-listing.md` pointing to it as superseded. The
submission itself is an owner action that no lane can take: it requires
Nish's SaaSHub account, his acceptance of the venue Terms and Privacy on the
already-open submission form, and his choices on the five owner decisions
(tagline/description version, verification inbox, founder details, optional
$99/month Featured Listing, and asset screenshots).

No code change was warranted in this lane. What this lane adds is a fresh
evidence pass dated 2026-08-14 (this run), confirming the prep is still
current before the scout item is closed as `unreviewed-by-opus`.

## Evidence on current main

- **Canonical prep**: `docs/saashub-listing-2026-08-11.md` — every
  submission form field (product name, `https://0509.io`, taglines,
  paste-ready description, categories, 18 verified competitor slugs,
  freemium pricing value, India startup details, features/specs, and the
  asset checklist) plus the honesty guardrails and the ownership-verification
  path via `support@0509.io` (`app/lib/support.ts:13`).
- **Submission blocker (owner step)**: the doc's "Submission status"
  section records that the SaaSHub submission page is open in Nish's logged-in
  browser with `https://0509.io` filled and nothing submitted; the next
  **Continue** button accepts the SaaSHub Terms and Privacy and must be
  confirmed by Nish before the form can be finished.

## Freshness pass (this lane, 2026-08-14)

Live HTTP checks from this worktree (all expected 200; 31/31 passed):

- Submission URL: `https://www.saashub.com/services/submit` — 200
- All five category pages (`/best-competitor-monitoring-software`,
  `/best-competitive-intelligence-software`, `/best-advertising-software`,
  `/best-website-monitoring-software`, `/best-competitor-research-software`)
  and the `Ad Spy` substitute (`/best-ad-spy-software`) — 200
- India startup page `https://www.saashub.com/startups/india` — 200
- Every listed competitor slug — 200, including the corrected
  `https://www.saashub.com/primespy-net` and `MagicBrief`
  (`https://www.saashub.com/magicbrief`, still listed at submission-time
  reference for the wind-down migration audience)
- Product pages: `https://0509.io/`, `https://0509.io/search`,
  `https://0509.io/auth/signup`, `https://0509.io/compare/magicbrief` — 200

Product facts in the listing copy re-checked against current main:

- Plan facts in the Pricing field (Free 1 competitor + weekly brief; Scout
  3 competitors / 6-hour checks; Starter 10 competitors / 3-hour checks +
  daily briefs; Agency 75 competitors) match `app/lib/plan-entitlements.ts`
  exactly (`free.watchlists=1`, `scout.watchlists=3` + `every_6h`,
  `starter.watchlists=10` + `every_3h` + `daily_and_weekly`,
  `agency.watchlists=75`).
- The description's claims ("checks every 3–6 hours", "quiet heartbeat",
  "screenshot evidence and change alerts before your next meeting") match the
  live homepage copy in `app/routes/marketing.tsx` verbatim (lines 32, 78,
  102, 140, 297–300).
- Support mailbox `support@0509.io` still exists in `app/lib/support.ts:13`
  for the SaaSHub ownership-verification requirement.

No corrections were needed: no 404s, no slug drift, no plan or copy drift
since the 2026-08-12 pass.

## Files

- `.lane/reports/0509-lane1-saashub-listing-already-prepared.md` — this
  evidence record (new).
- `docs/saashub-listing-2026-08-11.md` — one line added to the
  "Submission status" section recording the 2026-08-14 re-verification pass
  and pointing at this evidence record.

## Rollback

N/A — evidence-only lane record; no product code, data, or billing change.
