# Lane evidence — pi-issue-0509-2700 (issue #2700)

## Root cause — confirmed (a), already fixed by #2663

`saucony.co.uk` is a buyer-typed UK storefront that 302s onto
`www.saucony.com/UK/en_GB/home/`. Meta has never indexed the ccTLD as a term,
so #1999's "ask Meta for the registrable domain" rule returned a settled
0-row page for `website=saucony.co.uk` while `saucony.com` returned 8
verified rows. The fix — curated `providerQuery: "Saucony"` in
IDENTITY_OVERRIDES plus a `q:` cache-key segment — merged in #2663
(2026-09-10T20:07Z) with tests pinning ccTLD↔apex in both directions.

## Why the canary stayed red after the fix merged

Production deploys were red ~17h: last green deploy 2026-09-09T17:03Z; every
deploy-production run after that was cancelled (superseded queue) or failed
at Gate C (`proof_email_dispatch_invalid`, `proof_cleanup_failed` →
rollback). Tracked in #2662 / #2902 / AUTO-REVERT HALT issues — not part of
this issue. The #2663 fix reached production ~09:15Z 2026-09-11 (worker
version 2e723346).

## Live proof the gap is closed

- Direct probe 2026-09-11 ~10:0xZ:
  `GET https://0509.io/search?website=saucony.co.uk&country=all` →
  HTTP 200, headline "8 verified ads linked to saucony.co.uk".
- Scheduled canary run ~09:3xZ (log
  agent-state/cron-output/0509-sneaker-resale-recall-canary.log):
  `saucony.co.uk status=200 rows=30 8 verified / 0 likely / 22 unmatched`.

## Residual failure class fixed in this PR

After the saucony fix went live, the same canary run still failed — on a
different, transient cause: `finishline.com status=ERR` (fetch threw; the
issue body documents the same class for jdsports.com). A transport blip had
no retry and hard-failed the whole 25-domain sweep.

Live evidence on finishline.com: a direct probe returned HTTP 200 in
**30.66s** with "15 verified ads linked to finishline.com" — inside a
patient user's wait, just outside the canary's 30s budget. The cold path
awaits identity resolution (a redirect chain of homepage fetches, up to
~60s worst case) before any bytes return, so a >30s first response is a
legitimate cold-state latency, not a dead-end.

Fix shipped here: per-request timeout raised to 90s
(`PROBE_REQUEST_TIMEOUT_MS`) and fetch-throw/5xx retried twice at 60s
spacing (`REQUEST_ERROR_RETRY_LIMIT/DELAY_MS`) — the spacing lets an
in-flight server-side capture (kept alive by waitUntil after a client
abort) land before the retry asks again. A persistent failure still reports
`requestError` and fails loud — "cannot confirm" is never a pass,
carve-outs included (pinned in tests).

## Files

- `scripts/canary-sneaker-resale-recall.mjs` — 90s probe timeout, bounded
  transport-error retry (throw + >=500), failure line now names request
  errors.
- `tests/canary-sneaker-resale-recall.test.ts` — 6 tests pinning the retry
  and the cannot-confirm contract.
