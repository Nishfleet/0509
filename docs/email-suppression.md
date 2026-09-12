# Email suppression and send-path proof (issue #2983)

## What is now enforced in code

Outbound 0509.io email consults a suppression ledger before every provider send.

- **Ledger:** D1 `email_suppression`, migration `0096_email_suppression.sql`. One row
  per `(address, reason)`, `reason ∈ {bounce, complaint}`. Additive and one-way — no
  existing table or read path changed, so a deployment that has not yet run the
  migration behaves exactly as it did before.
- **Consult point:** `app/lib/delivery-email-core.server.ts` →
  `sendCloudflareEmail` calls `consultEmailSuppression` before
  `env.EMAIL.send`. Digests, instant alerts, presence digests, billing lifecycle,
  monthly recap, onboarding nudges and account emails all funnel through it.
- **The one other path:** `app/lib/better-auth.server.ts` magic links call the
  binding directly (they carry no unsubscribe shell), so they consult the same
  ledger themselves. `tests/email-send-chokepoint.test.ts` asserts that exactly
  these two modules reach the binding and that _both_ consult the ledger and feed
  it on failure, so a future third sender cannot quietly bypass suppression.
- **Bounce counting:** a definite provider failure increments
  `consecutive_failures`; at `EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES` (3) the
  address is suppressed. A successful acceptance deletes the bounce row, so
  transient blips self-heal. A provider _timeout_ stays unknown-and-retryable and
  is deliberately not counted as a failure.
- **Complaints:** `recordEmailComplaintSuppression` writes a sticky row that a
  later successful send never clears. Nothing writes complaint rows today — there
  is no feedback-loop relay wired up; the writer exists so a relay or an operator
  has a correct place to record one.
- **Unreadable ledger reads as "not suppressed".** A missing `DB` binding,
  pre-migration schema or provider outage makes the consult return `false`
  rather than failing the send. This is deliberate: the consult is strictly
  additive to pre-#2983 behavior.

Proof of the read path, the write path and the "suppressed address is never sent
to" contract lives in `tests/integration/email-suppression-2983.integration.test.ts`,
which applies the real migration chain under the workers pool and asserts the
provider binding is never called for a suppressed address.

## What is NOT yet proven: real external inbox receipts

`docs/customer-readiness-remediation.md` grades email B/C partly on "controlled
real inbox receipts". One Gmail and one Outlook receipt, with pasteable
`Authentication-Results` showing SPF/DKIM/DMARC pass, is **still open** and is not
claimed here.

It cannot be produced from a worker run: it needs a live deployed send to two
third-party mailboxes, the credentials/authority to trigger it, and eyes on two
external inboxes. Treat it as external proof, not code work. The open questions
for whoever picks it up:

1. Whether the Cloudflare `send_email` binding as configured here can deliver to
   arbitrary external addresses at all, or only to verified destinations. The
   repo holds no evidence either way; do not assume, test it.
2. If it can only reach verified destinations, the sending path itself has to
   change (a transactional provider or a dedicated subdomain with its own
   onboarding), and that is a product-direction call, not a bug fix.

The outbound _authentication_ half (SPF `~all`, DMARC `p=reject` with no `rua`,
no DKIM at a common selector) is tracked separately in #2966 — the receipt proof
above is the human-visible check that #2966's DNS work actually lands.
