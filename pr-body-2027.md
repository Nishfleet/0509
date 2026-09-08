## What

Adds the repo-local outbound mail path that issue #2027 names as the single mechanical blocker for the four prepared vendor listing submissions (ad-stack.ai, Segwise, Adyntel, GetHookd).

## How it works

`scripts/send-vendor-mail.mjs`:

- Parses the prepared email out of a doc under `docs/` — `To:` / `From:` / `Subject:` headers plus the `>` blockquote body inside the doc's "Ready-to-send" section (decoy headers elsewhere in the file are ignored by scoping to that section).
- Sends ONE plain-text email via the Cloudflare Email Sending REST API (`POST /accounts/{id}/email/sending/send`) — the same Cloudflare Email Service that backs the production Worker's `send_email` binding in `wrangler.jsonc`, reached over REST because this script runs on node, outside a Worker. The from-domain `0509.io` is already onboarded for that binding.
- **Dry-run by default**: no network, no writes. `--send` is the explicit opt-in.
- Credentials come from env only (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`); the token never appears in the request body or in printed output. Nothing is committed.
- On a successful real send, a receipt block (ISO timestamp, HTTP status, delivered/queued/permanent-bounces per recipient) is appended to the doc's `## Receipts` section (created if absent).
- Docs with no confirmed recipient (`segwise-listing-2026-08-21.md` — LinkedIn recommended, `gethookd-comparison-outreach-2026-08-21.md`) fail closed with a clear error naming the missing `To:` header; `--to` supplies it explicitly.

**It does NOT auto-send any of the four pitches.** Each doc's NEEDS-NISH owner decision stands; a real send remains a deliberate one-command action whose output the owner reviews.

## Verification

- `node scripts/send-vendor-mail.mjs --dry-run --doc docs/adstack-listing-2026-08-11.md` — exit 0, prints the parsed from/to/subject and full body, no network, no writes.
- Same for `docs/adyntel-listing-2026-08-21.md` — exit 0 (to: hello@adyntel.com).
- `docs/segwise-listing-2026-08-21.md` and `docs/gethookd-comparison-outreach-2026-08-21.md` — exit 1 with `no \`To:\` header found ... (pass --to to supply it)` — correct fail-closed behavior for docs with no confirmed vendor inbox.
- `npx vitest run --configLoader runner --project node tests/send-vendor-mail.test.ts` — **12/12 passed**, covering: dry-run path proves zero fetch calls (a fetch stub that throws is never invoked), no receipt written on dry-run, fail-closed on missing `To:`, receipt formatting (dated heading, per-recipient delivery status), append-under-existing/ create-if-absent `## Receipts`, real-send POST URL + `from: {address}` + auth header + token never printed, missing-credentials failure, API-error failure with no receipt, and delivered/queued parsing.
- `sgscan --base origin/main` — no new security findings (exit 0).

## run-proof

- Local run results above (dry-run across all four prepared docs + 12/12 vitest + sgscan clean). No units/timers/workflows created or changed by this PR — it is a node CLI script plus its test, additive and dormant until explicitly invoked.

organ-heartbeat: scripts/send-vendor-mail.mjs not-an-organ: plain one-shot CLI utility, no timer, daemon, or heartbeat to maintain

loose-ends: vendor-mail-send-decision — the four sends stay NEEDS-NISH; this PR ships plumbing only. segwise + gethookd docs additionally need a confirmed recipient before `--send` is possible at all.

research: no existing outbound-mail utility existed in scripts/ (checked scripts/ and app/lib; the only sender was the Worker `send_email` binding via the production app, unsuitable for one-off vendor mail — confirmed by docs/venue-submissions-status-2026-08-11.md). The REST API shape was taken from the Cloudflare Email Sending REST API reference (`from` uses `address`, response returns `delivered`/`queued`/`permanent_bounces` rather than a messageId).

help-first: `node scripts/send-vendor-mail.mjs --help`-equivalent is the usage line printed when `--doc` is omitted (exit 2): `usage: node scripts/send-vendor-mail.mjs --doc <docs/<file>.md> [--send] [--to <email>] [--subject <text>]`

Closes #2027
