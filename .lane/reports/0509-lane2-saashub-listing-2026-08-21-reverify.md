# Lane 2 report — SaaSHub listing for Five to Nine, freshness re-verification (2026-08-21)

**Item:** Prepare a manual SaaSHub listing for Five to Nine
[scout 2026-08-09, risk: green] [traction] [unreviewed-by-opus]

**Status:** VERIFIED_CURRENT — the manual SaaSHub listing is fully prepared
on `origin/main` (`docs/saashub-listing-2026-08-11.md`). This lane is a
fresh, independent freshness pass dated 2026-08-21 (six days after the
2026-08-15 opus review by lane 1). No SaaSHub-side drift, no slug drift, no
plan drift, no product-copy drift detected. Submission remains an owner step.

## Verdict

The listing preparation is still current and paste-ready. All 27 SaaSHub
slugs referenced in the canonical prep doc (1 submission page + 6 category
pages including the Ad Spy substitute + 1 India startup page + 18 direct
peers + MagicBrief) return HTTP 200 against the live site today; all 4
0509.io product URLs return 200; plan facts in the listing match
`app/lib/plan-entitlements.ts` exactly; the listing copy's three
load-bearing claims ("checks every 3–6 hours", "quiet heartbeat",
"screenshot evidence and change alerts") still appear verbatim in the live
homepage component; and the SaaSHub ownership-verification mailbox
(`support@0509.io`) is still in the source.

Submission remains an owner action that no lane can take: it requires
Nish's logged-in SaaSHub account, his acceptance of the SaaSHub Terms and
Privacy on the `https://www.saashub.com/services/submit` Continue button,
and his choices on the five owner decisions named in
`docs/saashub-listing-2026-08-11.md#owner-decisions` (tagline/description
version, verification inbox, founder + Startup Details, optional Featured
Listing, asset approval).

## What this lane checked (2026-08-21, live)

### SaaSHub surface — 35/35 URLs HTTP 200

| Check | Result |
|---|---|
| `https://www.saashub.com/services/submit` | 200 |
| Category pages (Competitor Monitoring, Competitive Intelligence, Advertising, Website Monitoring, Competitor Research, Ad Spy substitute) | 6/6 HTTP 200 |
| `https://www.saashub.com/startups/india` | 200 |
| 18 direct-category peers (`visualping`, `distill-io`, `wachete`, `kompyte`, `crayon`, `klue`, `rivalsweep`, `champsignal`, `myintelbrief`, `watch-my-competitor`, plus 8 ad-intelligence peers: `bigspy`, `socialpeta`, `adligator`, `primespy-net`, `pipiads`, `socialfuel`, `landingspy`, `semrush`) | 18/18 HTTP 200 |
| `magicbrief` (still listed, included for the wind-down migration audience via `/compare/magicbrief`) | 200 |
| Extra optional peers (8: `adspyder`, `poweradspy`, `adplexity`, `brand24`, `mention`, `awario`, `spyfu`, `adcreative-ai`) | 8/8 HTTP 200 |

No slug drift, no soft-404s, no rename noticed on the cross-section of
peers that other directory preps (BetaList, AlternativeTo) also rely on.

### 0509.io product surface — 4/4 URLs HTTP 200

| Check | Result |
|---|---|
| `https://0509.io/` | 200 |
| `https://0509.io/search` | 200 |
| `https://0509.io/auth/signup` | 200 |
| `https://0509.io/compare/magicbrief` | 200 |

### Repo source-of-truth cross-checks (current main tip, 2026-08-21)

- **Plan facts in the listing's Pricing field** (Free 1 competitor + weekly
  brief; Scout 3 competitors / 6-hour checks; Starter 10 competitors /
  3-hour checks + daily briefs; Agency 75 competitors) match
  `app/lib/plan-entitlements.ts` lines 126–185 exactly, and the
  re-export in `app/lib/plan.server.ts` line 33 still forwards
  `PLAN_LIMITS` and `getPlanEntitlements` unchanged:
  - `free: watchlists=1, digestCadence=weekly, scheduledScanCadence=weekly`
  - `scout: watchlists=3, digestCadence=weekly, scheduledScanCadence=every_6h`
  - `starter: watchlists=10, digestCadence=daily_and_weekly, scheduledScanCadence=every_3h`
  - `agency: watchlists=75, digestCadence=daily_and_weekly, scheduledScanCadence=every_3h`
- **Listing copy claim "checks every 3–6 hours"** still in
  `app/routes/marketing.tsx` line 227 (verbatim).
- **"screenshot evidence and change alerts"** still in
  `app/routes/marketing.tsx` line 38 (hero) and line 731 (FAQ-style card).
- **Public search line** — `app/routes/marketing.tsx` line 1303 — still
  reads "Paid plans run scheduled checks every 3–6 hours and email you
  the proof." verbatim.
- **Support mailbox** `support@0509.io` still exported at
  `app/lib/support.ts:13` for the SaaSHub ownership-verification step.

### Honest-claims guardrails — all still hold

- No Slack or WhatsApp delivery claims in the copy.
- No hardcoded currency (Dodo-backed localized checkout stays the
  single source of pricing truth).
- No unlimited-monitoring claim (every tier has a finite
  `includedEvidenceChecksPerMonth`).
- No `Real-time Monitoring` feature tag selected.
- Only `0509.io` domain references in copy and links.
- Meta-ads coverage labelled (`metaSourceStatus: unavailable | limited |
  priority` in entitlements); no auto-claimed TikTok/Google/LinkedIn
  ingestion in copy.
- Public data only (Meta Ad Library + public landing pages), per
  `MEMORY.md` honesty rule.

## Drift since the 2026-08-15 opus review

None observed on the SaaSHub side and none observed on the product side
within the window 2026-08-15 → 2026-08-21. Since the 2026-08-15 lane-1
opus-review report, `origin/main` has accumulated the typical mix of
product + dogfood + listing-lane merges documented in
`.lane/report.md`; none of them touched `docs/saashub-listing-2026-08-11.md`,
`app/lib/plan-entitlements.ts`, the SaaSHub-adjacent lines in
`app/routes/marketing.tsx`, or `app/lib/support.ts`.

## Findings

None — no corrections, no slug drift, no plan drift, no copy drift, no
support-mailbox drift.

## Owner step (unchanged since 2026-08-11)

The only remaining action is on Nish's side: on
`https://www.saashub.com/services/submit`, confirm Terms and Privacy, then
finish the form with the paste-ready fields in
`docs/saashub-listing-2026-08-11.md`, and verify ownership with
`support@0509.io` for the queue-priority lift. After submission, the
optional $99/month Featured Listing, the asset-checklist screenshots, and
the badge-embed follow-up stay owner decisions.

## Files

- `.lane/reports/0509-lane2-saashub-listing-2026-08-21-reverify.md` —
  this evidence record (unique to lane 2).
- `docs/saashub-listing-2026-08-11.md` — one paragraph added to the
  "Submission status" section recording the 2026-08-21 re-verification
  pass and pointing at this evidence record (no other change).

No shared report files touched (`docs/status.md`, `.lane/report.md` left
as-is). No product code touched.

## Proof

- Live fetches (2026-08-21): 8/8 SaaSHub URL slots (submit + 5 categories +
  Ad Spy substitute + India) HTTP 200; 27/27 competitor slugs HTTP 200;
  4/4 0509.io URLs HTTP 200.
- Repo (current main tip, commit ahead of `422fbd55`):
  `app/lib/plan-entitlements.ts` lines 126–185; `app/lib/plan.server.ts`
  lines 6–33; `app/lib/support.ts:13`; `app/routes/marketing.tsx` lines
  38, 227, 731, 1303.
- `docs/saashub-listing-2026-08-11.md` updated in this lane with the
  2026-08-21 entry above.

## Rollback

N/A — freshness-evidence lane; the doc delta is one paragraph in the
Submission-status log; revert is a `git revert` of the lane-2 commit if
ever needed.
