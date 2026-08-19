# Launch venue submissions — status 2026-08-11

One-line status of every prepared launch-venue listing for Five to Nine,
recorded 2026-08-11. Each venue's full preparation and receipt live in its
own document (linked below); this file exists so the fleet has a single
place to check where submission stands.

| Venue | Status | Exact next step |
|---|---|---|
| SaaSHub | **NEEDS_NISH_STEP** (not submitted) | Nish confirms the SaaSHub Terms and Privacy on the open submission page in his logged-in Mac browser (`https://0509.io` is filled), then the browser run can continue. Mailbox prerequisite cleared: live Gmail → Agentic Inbox delivery test to `support@0509.io` succeeded 2026-08-11. |
| BetaList | **SKIPPED_PAID** (not submitted) | None — BetaList's official Support page says all submissions are paid and there is no free submission option; the venue is skipped and the prepared copy stays on file. Paid-only requirement and all listing copy re-verified 2026-08-12 (see `docs/betalist-listing-2026-08-10.md` re-verification log). |
| AlternativeTo | **NEEDS_NISH_STEP** (not submitted) | Nish signs in (or creates and verifies) the AlternativeTo account, then the prepared suggestion can be submitted. The optional $5 priority review is skipped. |
| ad-stack.ai | **READY_TO_SEND** (not sent) | The whole submission is one email — send the prepared note (name + URL + short description, per the venue's About page) from `support@0509.io` to `hello@ad-stack.ai`. No account, form, or payment required. The venue promises no coverage; the realistic target is the next quarterly re-test of its "best ad intelligence software in 2026" essay (~October 2026). |

Nothing was submitted on 2026-08-11: SaaSHub and AlternativeTo both wait on
a Nish step, BetaList was deliberately skipped, and the ad-stack.ai email is
prepared and waiting only on the send (no repo-local outbound mail path
exists; the product's only sender is the production Worker `send_email`
binding, which is not used for one-off vendor mail).

## Receipts

- `docs/saashub-listing-2026-08-11.md` — SaaSHub receipt (canonical; the
  older `docs/saashub-listing.md` points to it).
- `docs/betalist-listing-2026-08-10.md` — BetaList receipt.
- `docs/alternativeto-listing-2026-08-11.md` — AlternativeTo receipt.
- `docs/adstack-listing-2026-08-11.md` — ad-stack.ai receipt.
