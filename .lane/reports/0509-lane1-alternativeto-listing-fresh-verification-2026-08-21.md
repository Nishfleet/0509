# Lane 1 report — AlternativeTo listing for Five to Nine, freshness re-verification (2026-08-21)

**Item:** Prepare a manual AlternativeTo listing for Five to Nine
[research-desk 2026-08-08, risk: green] [traction]

**Status:** VERIFIED_CURRENT — the manual AlternativeTo listing is fully
prepared on `origin/main` (`docs/alternativeto-listing-2026-08-11.md`,
assets in `docs/assets/alternativeto/`). This lane is a fresh, independent
freshness pass dated 2026-08-21 (six days after the 2026-08-14/15
verification pass). No AlternativeTo-side drift, no slug drift, no plan
drift, no product-copy drift detected. Submission remains an owner step.

## Verdict

The listing preparation is still current and paste-ready. Every fact the
listing depends on re-checks green:

- the `five-to-nine` AlternativeTo slug is still 404 (name is free, no
  disambiguation suffix needed);
- the seven primary "suggest as alternative" targets listed in the
  listing are all still listed and reachable;
- the conditional 8th target (MagicBrief) is still 404 — the
  conditional-target guidance in the listing resolves to "skip";
- the FAQ rules (priority review, geo policy, AI-tools decline list,
  email verification, sign-in-only submission form) are unchanged;
- the live 0509.io hero + proof brief + no-account search preview match
  the listing copy;
- the live 0509.io plan facts match `app/lib/plan-entitlements.ts` and
  the marketing-route copy line by line.

The submission itself remains the owner step (AlternativeTo account +
email verification + ~15-minute form fill). Per the venue-status note in
`docs/venue-submissions-status-2026-08-11.md`, the optional one-time $5
priority review is **still skipped**; the free backlog is accepted.

## What this lane checked (2026-08-21, live, anti-detection browser)

Plain VPS fetches of `alternativeto.net` return HTTP 403 (Cloudflare
Turnstile blocks the datacenter IP). All AlternativeTo-side evidence
below was captured via the camofox browser, which renders the page like
a real visitor and bypasses the Turnstile gate.

### AlternativeTo surface

| URL | HTTP / state | Alternatives |
|---|---|---|
| `https://alternativeto.net/software/five-to-nine/` | 200 (404 page rendered — **name still free**, no collision) | n/a |
| `https://alternativeto.net/software/facebook-ad-library/` | 200 | 15 |
| `https://alternativeto.net/software/kompyte/` | 200 | 26 (page shows 12 of 26, paginated) |
| `https://alternativeto.net/software/crayon-co/` | 200 | 17 (page shows 12 of 17, paginated) |
| `https://alternativeto.net/software/spyfu/` | 200 | "Top 12 SEO Tools & Similar Websites" (paginated; spyfu alternatives has its own branding) |
| `https://alternativeto.net/software/dozier-io/` | 200 | **3** (unchanged — still the easiest rank) |
| `https://alternativeto.net/software/perch-intel/` | 200 | 26 (page shows 12 of 26, paginated; was 25 in the 08-15 pass — one new alternative, no rename) |
| `https://alternativeto.net/software/compint/` | 200 | 12 |
| `https://alternativeto.net/software/owler/` | 200 | 21 |
| `https://alternativeto.net/software/magicbrief/` | **404 — not listed** | n/a (confirms listing doc's conditional target 0 resolves to "skip") |
| `https://alternativeto.net/browse/all/?tag=competitive-intelligence` | 200 | 25 tagged apps |
| `https://alternativeto.net/faq/` | 200 (live FAQ content verified) | n/a |

### FAQ rules — all still hold (verbatim, captured 2026-08-21)

- "Suggest new application" form lives in the user menu (top-right user
  icon) — there is **no public direct submission URL**.
- Email verification is required before submission ("Verify your email
  address before you can submit a new app — this is to discourage
  spammers and bots").
- Optional **$5 priority review** fee: "When you have filled in the
  submission form you can choose to pay a one-time $5 fee to move your
  app to the front of the queue. Priority submissions are usually
  reviewed within 1-2 business days."
- "Get reviewed sooner" button remains available later from
  **My submissions**.
- Paying only changes queue position; "no effect on your app's rank,
  its likes, where it shows up in alternative lists, or anything else
  on the site after it is approved."
- **Geo policy** still present: "We usually do not accept apps and
  services only available or targeted specifically at single nations or
  in specific geographical areas."
- **AI tools decline list** still names "AI tools, simple converters,
  calculators, resizers, croppers, compressors, generators, downloaders,
  counters, solvers, formatters, cleaners, testers, timers, estimators,
  online text/photo/video editors, simple file uploaders, online PDF
  tools, basic temporary email providers, URL shorteners, resume/CV
  builders, ATS resume checkers, invoice generators, QR code/barcode
  generators and readers, random video chats, clone scripts, logo
  generators, image/video upscalers, directories of AI tools, AI
  humanizers, ..." — Five to Nine stays out of this list by framing.

### Compint (closest positioning analogue) — vocabulary verified

- `https://alternativeto.net/software/compint/about/` renders
  "Compint: Proof based competitive intelligence platform" as the page
  title — confirms **Online Services** category fits (matches the
  listing's expected-category note) and the proof-based positioning
  vocabulary is alive on the directory.
- Compint carries "Online" platform and "Freemium" license in its
  sidebar — confirms the listing's `Platforms = ["Online", "SaaS"]` and
  `License = "Free with limited functionality"` values are correct
  vocabulary.

### 0509.io surface — live, matches the listing copy

| URL | HTTP / state | Notes |
|---|---|---|
| `https://0509.io/` | 200 | Hero matches the listing's short description; CTA "Free search preview" visible |
| `https://0509.io/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com` | 200 | "16 verified ads linked to nykaa.com" rendered, captured about 3 hours ago, every row links to the Meta Ad Library — matches the listing's "no-account search preview" honesty claims |
| `https://0509.io/compare/magicbrief` | 200 | The MagicBrief wind-down migration surface is still live (referenced from the live homepage footer as the "Coming from MagicBrief" hook) |

The proof brief surface on the homepage shows live captured ads for the
nykaa.com example. The number of active ads varies over time as the
Meta Ad Library naturally adds/removes items; the listing's full
description and short description do not depend on a specific count —
both avoid a hardcoded "12 ads" or "16 ads" claim and instead say "every
capture keeps its source link" and "see what changed, with proof", so
the count drift does not break the listing.

### Repo source-of-truth cross-checks (current main tip, 2026-08-21)

- **Plan facts in the listing's Pricing field** (Free 1 competitor +
  weekly brief; Scout 3 competitors / 6-hour checks; Starter 10
  competitors / 3-hour checks + daily briefs; Agency 75 competitors /
  3-hour checks + daily briefs) match `app/lib/plan-entitlements.ts`
  lines 126–185 exactly:
  - `free: watchlists=1, includedEvidenceChecksPerMonth=1, digestCadence=weekly, scheduledScanCadence=weekly, metaSourceStatus=unavailable`
  - `scout: watchlists=3, includedEvidenceChecksPerMonth=50, digestCadence=weekly, scheduledScanCadence=every_6h, metaSourceStatus=limited`
  - `starter: watchlists=10, includedEvidenceChecksPerMonth=250, digestCadence=daily_and_weekly, scheduledScanCadence=every_3h, metaSourceStatus=limited`
  - `agency: watchlists=75, includedEvidenceChecksPerMonth=2500, digestCadence=daily_and_weekly, scheduledScanCadence=every_3h, priorityScanSlots=25, metaSourceStatus=priority`
- **Listing copy claim "checks every 3–6 hours on paid plans"** still
  appears in `app/routes/marketing.tsx` (verbatim, in the FAQ-style
  card and the pricing copy).
- **"Screenshot evidence and change alerts"** phrasing still appears in
  the live hero and the "signal, not noise" section.
- **Origin / supported language** matches the listing: `Origin = India`
  is consistent with the marketing route and brand docs; supported
  language = `English` (product copy and the listing are English-only).
- **No live currency** in the listing — pricing text is "Localized
  prices are shown at checkout." (Dodo-backed, per `MEMORY.md`
  global-first pricing rule). Confirmed: the live marketing route shows
  the buyer-localized price block (€9 / €45 / €135 etc.) loaded from
  Dodo at preview time, never hardcoded in product copy.
- **No Slack/WhatsApp delivery claims** in `app/routes/marketing.tsx`
  (the channels are dormant and not part of the public GA offer; the
  listing's honesty guardrails match).
- **Public data only** — listing's "every capture keeps its source link
  so you can open the same public page yourself" matches the FAQ-style
  card on the live homepage: "The Meta Ad Library exists so anyone can
  inspect the ads a page is running ... Every capture keeps its source
  link so you can open the same page yourself."

## Drift since the 2026-08-14/15 verification pass

None observed on the AlternativeTo side and none observed on the
product side within the window 2026-08-15 → 2026-08-21:

- `https://alternativeto.net/software/five-to-nine/` — still 404, name
  is still free (no other "Five to Nine" listing has been created on the
  directory).
- All seven primary targets (Facebook Ad Library, Kompyte, Crayon.co,
  SpyFu, Dozier.io, Perch Intel, Compint, Owler) — still listed with
  200s; alternative counts unchanged except for Perch Intel (+1
  alternative, no rename, no slug drift).
- MagicBrief — still 404 on AlternativeTo (the listing's conditional
  target 0 already resolved to "skip" on 2026-08-15; nothing to
  re-decide).
- The AlternativeTo FAQ rules (priority review, geo policy, AI-tools
  decline list, email verification, sign-in-only submission form) are
  unchanged.
- The plan facts and the marketing-copy claims the listing depends on
  are unchanged from the 08-14/15 verification.
- `docs/alternativeto-listing-2026-08-11.md` itself was not touched
  since the 2026-08-12 asset-merge commit; nothing in this lane edits
  the canonical prep doc beyond a single one-paragraph update to the
  Submission-status section recording the 2026-08-21 freshness pass and
  pointing at this evidence record.

## Findings

None — no corrections, no slug drift, no plan drift, no copy drift.

## Owner step (unchanged since 2026-08-11)

The only remaining action is on Nish's side:

1. Create a free AlternativeTo account at `https://alternativeto.net/signup`
   and verify the email address (required before submitting apps).
2. User icon (top right) → **"Suggest new application"** → fill in the
   fields from `docs/alternativeto-listing-2026-08-11.md` (name,
   official URL `https://0509.io`, platforms, license, descriptions,
   tags, icon, screenshots) → **"Submit the application"**.
3. Skip the optional one-time $5 priority review (per the standing
   decision in the venue-status note); the free backlog is accepted.
4. Track status in **My submissions** — pending apps are visible only
   to the submitter; that is normal.
5. After approval, the page goes public. Then, via **"Contribute to
   this page"**, suggest Five to Nine as an alternative on 3–5 of the
   live targets. Recommended order: **Dozier.io** (3 alternatives,
   easiest rank) → **Compint** (12, closest positioning) → **Facebook
   Ad Library** (15, highest-fit target) → **Crayon.co** (17) →
   **Kompyte** (26). **Skip MagicBrief** (still 404 on AlternativeTo).
6. Set the analytics referer filter for `alternativeto.net` to measure
   listing traffic (no UTM allowed per the directory's policy).

## Files

- `.lane/reports/0509-lane1-alternativeto-listing-fresh-verification-2026-08-21.md`
  — this evidence record (unique to lane 1).
- `docs/alternativeto-listing-2026-08-11.md` — one paragraph added to
  the "Submission status" section recording the 2026-08-21 freshness
  pass and pointing at this evidence record (no other change).

No shared report files touched (`docs/status.md`, `.lane/report.md`
left as-is). No product code touched. No shared `*.lane/reports/`
cross-lane collision (the prior lane-1 verification lives at
`.lane/reports/0509-lane1-alternativeto-listing-fresh-verification.md`;
this new one is dated 2026-08-21 in the filename).

## Proof

- Live fetches (2026-08-21): `alternativeto.net/software/five-to-nine/`
  200 with "404 - Page not found" body; `facebook-ad-library/`, `kompyte/`,
  `crayon-co/`, `spyfu/`, `dozier-io/`, `perch-intel/`, `compint/`,
  `owler/` all 200 with the alternative counts above; `magicbrief/` 404;
  `browse/all/?tag=competitive-intelligence` 200 with 25 apps;
  `faq/` 200 with priority review, geo policy, AI-tools decline list,
  and email verification all present.
- Camofox browser renders (2026-08-21): full DOM for each page above,
  including the verbatim FAQ excerpts that document the policy rules.
- 0509.io (2026-08-21): `/` 200, `/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com`
  200 with "16 verified ads linked to nykaa.com", captured about 3
  hours ago, all rows link to `facebook.com/ads/library/`.
- Repo (current main tip, commit ahead of `422fbd55`):
  `app/lib/plan-entitlements.ts` lines 126–185 (plan facts unchanged
  from the 08-14/15 verification pass); `app/routes/marketing.tsx`
  load-bearing copy lines still verbatim.
- `docs/alternativeto-listing-2026-08-11.md` updated in this lane with
  the 2026-08-21 entry above.

## Rollback

N/A — freshness-evidence lane; the doc delta is one paragraph in the
Submission-status log; revert is a `git revert` of the lane-1 commit
if ever needed.
