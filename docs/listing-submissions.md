# Listing submissions ledger (receipts pass 2026-09-11, issue #2857)

One page mapping every queued directory/listing artefact → status → receipt.
Closeout of the §1.6 finding ("100% drafted, 0% sent") for the 7 artefacts that
sat unsent since 2026-08-11, per the 2026-09-09 direction (fleet-ops#4518:
listings are in-scope unpaid distribution). Zero artefacts remain silently
PREPARED: each carries a line-start `receipt:` or `blocked:` status line in its
own document, enforced going forward by `tests/unit/listing-receipts.test.ts`
(any new `docs/*listing*.md` must carry a status line on landing).

receipt: 2 of 7 submitted and approved (SaaSHub, both docs — live at
https://www.saashub.com/five-to-nine, re-verified 2026-09-11); 5 of 7 blocked
with reasons recorded inline in each doc (1 payment wall, 4 owner-identity /
capability walls). No coverage of the sent listing is claimed beyond the live
SaaSHub page — the unsent venues are blocked, not abandoned.

| Artefact | Venue | Status | Receipt / blocker | Unblock step (owner) |
|---|---|---|---|---|
| `docs/saashub-listing-2026-08-11.md` | SaaSHub | ✅ SUBMITTED + APPROVED (live 2026-08-22) | receipt: https://www.saashub.com/five-to-nine (HTTP 200 re-verified 2026-09-11) | Optional only: ownership verification, Features & Specs correction, $99/month Featured Listing (separate money decision) |
| `docs/saashub-listing.md` | SaaSHub (pointer, superseded by the canonical doc) | ✅ SUBMITTED + APPROVED (live 2026-08-22) | receipt: https://www.saashub.com/five-to-nine | None — pointer doc only |
| `docs/adstack-listing-2026-08-11.md` | ad-stack.ai (journal, no form) | ⛔ blocked | blocked: needs Nish's identity — one paste-ready email from `support@0509.io` to `hello@ad-stack.ai`; no repo-local outbound mail path exists | Send the prepared email (under a minute); targets the ~October 2026 quarterly re-test |
| `docs/adyntel-listing-2026-08-21.md` | Adyntel + Trendtrack (listicles) | ⛔ blocked | blocked: needs Nish's identity — one paste-ready email from `support@0509.io` (Adyntel mailto) plus one author-byline / X message (Trendtrack, never a sales-mail account signup) | Send both emails; success = author reply or a future refresh |
| `docs/alternativeto-listing-2026-08-11.md` | AlternativeTo (form) | ⛔ blocked | blocked: needs Nish's identity — free account + verified email (none exists) and the VPS IP is Cloudflare-Turnstile-blocked (HTTP 403, re-verified 2026-09-11) | Create/verify the AlternativeTo account, then a ~15-minute form fill; $5 priority review stays skipped (free backlog) |
| `docs/betalist-listing-2026-08-10.md` | BetaList (form) | ⛔ blocked | blocked: payment wall — Nish decision (all submissions are paid; "no free submission option", verified live 2026-09-09) | Owner money decision on the paid tier; prepared copy stays on file |
| `docs/segwise-listing-2026-08-21.md` | Segwise (roundup, no form) | ⛔ blocked | blocked: needs Nish's identity — one paste-ready pitch via LinkedIn to the author (Angad Singh) or email from `support@0509.io` to a confirmed vendor inbox (none confirmed) | Send the pitch; success = author reply or the next "Updated …" cycle |

## What this ledger is not

- **Not a claim of listing.** Only SaaSHub is live. The 4 editorial venues
  (ad-stack.ai, Adyntel, Trendtrack, Segwise) promise no coverage by design —
  a send is a submission into a future update cycle, and "listed" is recorded
  only when the venue changes or replies.
- **Not an abandoned queue.** Every blocker is specific and small: one email,
  one LinkedIn message, one account signup. The sends are the owner's identity,
  which is exactly why they could not be fired by an unattended worker.
- **Not a paid-channel decision.** BetaList's paid tier and SaaSHub's Featured
  Listing stay owner money decisions; no listing-purchase line exists in the
  budget policy.

## Maintenance

New listing drafts land in `docs/` only with a `receipt:` or `blocked:` line
(the gate test fails otherwise). When an owner send happens: append the send
date to the artefact's status, flip this row to ✅ with the confirmation, and
add the `receipt:` line. Canonical status per artefact lives in the artefact
docs — this ledger maps, it does not supersede.
