# Outbound email authentication — 0509.io

Audited 2026-09-11 (issue #2966, two independent blind auditors). Finding at
audit time: SPF `~all` softfail, DMARC `p=reject` with no `rua`, and no DKIM
TXT at any common selector (`default`, `cf1`, `cf2`, `cf2024-01`).

## Verified live state (re-checked 2026-09-11 via dig + Cloudflare Email Routing API)

| Assertion | Record |
| --- | --- |
| SPF | `v=spf1 include:_spf.mx.cloudflare.net -all` (hardfail) |
| DMARC | `v=DMARC1; p=reject; rua=mailto:dmarc@0509.io` |
| DKIM | `cf2024-1._domainkey.0509.io` — `v=DKIM1; h=sha256; k=rsa; p=MIIBIj…` |
| Bounce path | `cf-bounce.0509.io` SPF `~all` (softfail is correct for a bounce subdomain) + `cf-bounce._domainkey` DKIM, same RSA key |
| Inbound | MX `route{1..3}.mx.cloudflare.net`, Email Routing enabled + synced, catch-all routes to the `0509-support-inbox` worker (so `rua` reports to `dmarc@0509.io` land there) |

**The real DKIM selector is `cf2024-1`.** Authority: Cloudflare's own
`GET /zones/{zone}/email/routing/dns` returns this exact record as part of the
recommended DNS configuration for the verified 0509.io domain. Common
Selectors `cf1`, `cf2`, `cf2024-01` and `default` are intentionally empty.

## Deliverability split between issues

- This file + the DNS half: `#2966`.
- Delivery proof (real Gmail/Outlook receipts, bounce/complaint suppression,
  Authentication-Results from a real inbox on the outbound path): `Nishfleet/0509#2983`.

## Regression gate

`node scripts/check-outbound-email-auth.mjs` fails loud (exit 1) if any of
these regress: SPF softfail, DMARC without `p=`/`rua`, DKIM not published at
`cf2024-1._domainkey` (selector list overridable via `CHECK_DKIM_SELECTORS`).
Run it after any Cloudflare Email or zone-DNS change.

Exit codes are independent of output format, so `--json` (the mode automation
uses) still exits non-zero on a regression:

| Exit | Meaning |
| --- | --- |
| 0 | all assertions pass |
| 1 | one or more assertions failed (a real regression) |
| 2 | infrastructure error — `dig` missing or unreachable, or a malformed selector |

The gate is not yet wired to a runner: it runs on demand and in tests, not on a
schedule. Wiring it to a timer or CI job is the remaining loose end.
