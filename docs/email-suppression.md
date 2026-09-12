# Email suppression and send-path proof (issue #2983)

## What is now enforced in code

Outbound 0509.io email consults a suppression ledger before every provider send.

- **Ledger:** D1 `email_suppression`, migration `0096_email_suppression.sql`. One row
  per `(address, reason)`, `reason ∈ {bounce, complaint}`. Additive and one-way — no
  existing table or read path changed, so a deployment that has not yet run the
  migration behaves exactly as it did before.
- **Consult point:** `app/lib/delivery-email-core.server.ts` →
  `sendCloudflareEmail` calls `consultEmailSuppression` before `env.EMAIL.send`.
  Digests, instant alerts, presence digests, billing lifecycle, monthly recap,
  onboarding nudges and account emails all funnel through it. One exception,
  outside the Worker: `scripts/send-vendor-mail.mjs` is a manual operator script
  that posts to the Cloudflare Email Sending REST API with its own token and does
  not consult the ledger. It is not a product send.
- **The one other path:** `app/lib/better-auth.server.ts` magic links call the
  binding directly (they carry no unsubscribe shell), so they consult the same
  ledger themselves and apply the same recipient-rejection rule. A suppressed
  magic-link request returns normally and the user sees the usual "check your
  email" state, so suppression status is never disclosed to the requester — which
  means the most likely support ticket this change creates is "I was told to check
  my email and it never arrived".
- **Bounce counting:** a *recipient rejection* increments `consecutive_failures`;
  at `EMAIL_SUPPRESS_AFTER_CONSECUTIVE_FAILURES` (3) the address is suppressed for
  `EMAIL_BOUNCE_SUPPRESSION_TTL_MS` (30 days). A successful acceptance deletes the
  bounce row, so counts self-heal below the threshold. A provider **timeout** stays
  unknown-and-retryable and is never counted.
- **Only recipient rejections count.** A provider outage, rate limit or binding
  misconfiguration fails every recipient on the same cron tick, so counting those
  would suppress a large slice of the customer base at once for a fault that says
  nothing about any one mailbox. The classifier (`isRecipientRejection`) is
  deliberately conservative — an unrecognised error is **not** a bounce — because
  this binding throws plain `Error`s with no machine-readable code, so message text
  is the only signal available.
- **A bounce suspension always lapses.** Nothing here can *prove* a mailbox is
  dead, and the counter cannot tell a dead user from an outage, so suppression must
  never be permanent: the address is tried again after the 30-day window. If it is
  genuinely dead, three more failures re-suppress it for another window — one
  provider attempt per window, not a retry on every cron tick. This matters because
  the success path that clears a row lives *after* the provider call, which a
  suppressed address never reaches; without the TTL a tripped address would be
  locked out forever with no way back.
- **Complaints:** `recordEmailComplaintSuppression` writes a sticky row that a
  later successful send never clears. Nothing writes complaint rows today — there
  is no feedback-loop relay wired up; the writer exists so a relay or an operator
  has a correct place to record one. A sticky, never-clearable reason with no
  writer and no clearer is a loaded gun for whoever wires that relay later, so add
  a matching removal path with the writer.
- **Unreadable ledger reads as "not suppressed".** A missing `DB` binding,
  pre-migration schema or provider outage makes the consult return `false` rather
  than failing the send. This is deliberate: the consult is strictly additive to
  pre-#2983 behavior.

Proof of the read path, the write path and the "suppressed address is never sent
to" contract lives in `tests/integration/email-suppression-2983.integration.test.ts`,
which applies the real migration chain under the workers pool and asserts the
provider binding is never called for a suppressed address.

## Known cost

A suppressed address is reported to the caller as `status: "failed"` with
`webhookStatus: "failed"`, because `EmailProviderResult` has no "skipped" variant.
Downstream code that treats that pair as "definite failure, retry-claim it" will
re-enter the delivery pipeline for a permanently suppressed address for as long as
the period lasts. The consult re-blocks each time, so no email is sent, but the
work and the attempt rows are wasted and a little misleading: they describe a send
that deliberately never happened. Worth a `"skipped"` status if that fan-out grows.

## What is NOT yet proven: real external inbox receipts

`docs/customer-readiness-remediation.md` grades email B/C partly on "controlled real
inbox receipts". One Gmail and one Outlook receipt, with pasteable
`Authentication-Results` showing SPF/DKIM/DMARC pass, is **still open** and is not
claimed here. It is filed as #3132.

It cannot be produced from a worker run: it needs a live deployed send to two
third-party mailboxes, the authority to trigger it, and eyes on two external
inboxes. Treat it as external proof, not code work. The open questions for whoever
picks it up:

1. Whether the Cloudflare `send_email` binding as configured here can deliver to
   arbitrary external addresses at all, or only to verified destinations. The repo
   holds no evidence either way; do not assume, test it.
2. If it can only reach verified destinations, the sending path itself has to
   change (a transactional provider or a dedicated subdomain with its own
   onboarding), and that is a product-direction call, not a bug fix.

The outbound *authentication* half (SPF `~all`, DMARC `p=reject` with no `rua`, no
DKIM at a common selector) is tracked separately in #2966 — the receipt proof above
is the human-visible check that #2966's DNS work actually lands.
