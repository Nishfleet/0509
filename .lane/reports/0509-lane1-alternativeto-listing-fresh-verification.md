# Lane 1 report — AlternativeTo listing for Five to Nine, fresh live re-verification (2026-08-14/15)

**Item:** Prepare a manual AlternativeTo listing for Five to Nine
[research-desk 2026-08-08, risk: green] [traction]

**Status:** VERIFIED_CURRENT — the manual listing is fully prepared on main;
this lane re-verified every live fact the listing depends on (2026-08-14/15)
and records the exact owner step that remains.

## What is already done (on main, no action needed from this lane)

- `docs/alternativeto-listing-2026-08-11.md` — complete paste-ready listing
  (every "Suggest new application" form field, tags, features, honesty
  guardrails, approval risks, submission process, traffic attribution).
- `docs/venue-submissions-status-2026-08-11.md` — venue row tracks it.
- Open PR #664 (`docs/alternativeto-listing-assets`, lane-12's work) adds the
  committed submission assets (squared 512px icon + homepage/search
  screenshots). **That PR currently sits CONFLICTING** and needs a rebase
  before it can merge — see Recommendation.

## Fresh live verification (2026-08-14/15, anti-detection browser + fetches)

Every fact below was re-checked against the live sites this lane ran; the
earlier 08-11 verification gap (AlternativeTo blocked plain VPS fetches) is
now closed.

### Name availability — still free

- `https://alternativeto.net/software/five-to-nine/` → HTTP 200 with
  "404 - Page not found" (camofox browser render confirmed). No collision,
  no disambiguation suffix needed.

### Official website — live and matching listing copy

- `https://0509.io/` → live; hero and copy match the listing's short and
  full descriptions (proof-first change monitoring, 05:09 morning brief,
  no-account search preview).
- No-account search preview `https://0509.io/search?query=nykaa&mode=advertiser&website=https%3A%2F%2Fnykaa.com`
  → live, rendered "16 verified ads linked to nykaa.com", captured "about an
  hour ago", with source/freshness labeled per the listing's honest-claims
  rules.

### Suggest-as-alternative targets (all re-verified live)

| Target | URL | Status | Alternatives count |
|---|---|---|---|
| Facebook Ad Library | `/software/facebook-ad-library/` | 200, live | 15 |
| Kompyte | `/software/kompyte/` | 200, live | 26 |
| Crayon.co | `/software/crayon-co/` | 200, live | 17 |
| SpyFu | `/software/spyfu/` | 200, live | 46 |
| Dozier.io | `/software/dozier-io/` | 200, live | 3 |
| Perch Intel | `/software/perch-intel/` | 200, live | 25 |
| Compint | `/software/compint/` | 200, live | 12 |
| Owler | `/software/owler/` | 200, live | 21 |
| MagicBrief | `/software/magicbrief/` | **404 — not listed** | n/a |

- **MagicBrief is NOT on AlternativeTo** (404). The listing doc's conditional
  target 0 (suggest on the MagicBrief page if still listed) is resolved: skip
  it. The live `/compare/magicbrief` migration guide remains the right
  capture surface for that audience; MagicBrief buyers will not be reached
  via an AlternativeTo page.
- Dozier.io remains the easiest rank (3 alternatives).

### Tags and features — all resolve live

- `competitive-intelligence` tag page resolves (URL is
  `/browse/all/?tag=competitive-intelligence`). The other listed tags
  (market-intelligence, market-research, brand-monitoring, product-marketing,
  marketing, competitors-research, competitor-price-monitoring) are the same
  verified vocabulary used on live competitor pages.

### Category / platforms / license conventions — verified

- Compint (closest positioning analogue, "proof based competitive
  intelligence platform") is confirmed in the **Online Services** category —
  matching the doc's expected-category note.
- Live competitor pages confirm "Online", "Software as a Service (SaaS)"
  platforms and "Freemium / Free with limited functionality" license values
  the listing prescribes.

### Official FAQ — every policy claim in the doc still current

- Add via User icon → "Suggest new application"; email verification required.
- New apps sit in review backlog "at least a few months"; optional one-time
  $5 priority review moves to front, doesn't buy approval, refundable until
  the review, non-refundable after; "Get reviewed sooner" from My submissions.
- Descriptions must not contain links/emails/phone numbers; no UTM on the
  official URL (use HTTP Referer).
- English only; open beta/public access accepted (closed beta/announced-only
  rejected); single entry per product; geo policy ("usually do not accept
  apps ... targeted specifically at single nations"); decline list includes
  basic AI tools / LLM wrappers — supporting the doc's no-AI-framing guardrail.

### The one submission-entry URL to record

- `https://alternativeto.net/suggest-app/` is **not a public page** (404);
  the submission form is only reachable through the logged-in user menu, as
  the doc says. No direct pre-fill URL exists.

## Recommendation

1. **Rebase/land PR #664** (`docs/alternativeto-listing-assets`) — it is
   conflicting and carries the committed icon + screenshots the listing
   needs. It also touches the shared `.lane/report.md` (anti-pattern), but
   the asset files and doc updates are the value; the fleet should get it
   merged (or at least its assets) before submission.
2. **Owner step (Nish):** create/verify the AlternativeTo account, then fill
   the ~15-minute form using `docs/alternativeto-listing-2026-08-11.md`
   (fields are paste-ready). Skip the optional $5 priority review per the
   standing decision; the free backlog is accepted.
3. After approval, suggest Five to Nine as an alternative on 3–5 of the live
   targets (Dozier.io 3 alternatives, Compint 12, Facebook Ad Library 15,
   Crayon.co 17, Kompyte 26 — not MagicBrief, it is not listed).
4. Set the analytics referer filter for `alternativeto.net` to measure
   listing traffic (no UTM allowed).

## Files

- `.lane/reports/0509-lane1-alternativeto-listing-fresh-verification.md`
  (this report; unique to this lane).

## Proof

- Live fetches (2026-08-14/15): five-to-nine 404; facebook-ad-library 200;
  kompyte 200; crayon-co 200; spyfu 200; dozier-io 200; perch-intel 200;
  compint 200; owler 200; magicbrief 404; competitive-intelligence tag 200;
  FAQ 200.
- Camofox browser renders: 0509.io homepage + no-account search preview
  ("16 verified ads linked to nykaa.com", ~1h freshness); five-to-nine 404
  page; suggest-app 404.
