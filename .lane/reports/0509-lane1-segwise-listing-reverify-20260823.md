# Lane 1 report — Segwise listing pitch, freshness re-verification (2026-08-23)

**Item id:** `158b717fe9`

**Item:** Get Five to Nine listed on Segwise's July 2026 "Best Ad Spy and
Competitor Tracking Tools" comparison — current-month on-call listing item
[lane 1, 2026-08-23] [traction]

**Status:** VERIFIED_CURRENT / still-not-listed — the prepared pitch on
`origin/main` (`docs/segwise-listing-2026-08-21.md`) is still paste-ready.
A fresh live pass dated 2026-08-23 found the roundup still does not name
Five to Nine or `0509.io`. The send remains blocked on an owner decision.
This lane did not send anything.

## Verdict

The venue still does not include Five to Nine. Pitch facts still match
current product copy. Status stays PREPARED — ready to send. Inclusion is
the author's editorial call; this record is a verification, not a send
state, and not a coverage claim.

## What this lane checked (2026-08-23, live)

### Step 0 — roundup body

Fetched `https://segwise.ai/blog/best-ad-spy-competitor-tools` to
`/tmp/opencode/segwise-article.html`.

| Check | Result |
|---|---|
| HTTP status | `200` |
| `rg -ci "five to nine\|0509\.io"` on the fetched HTML | exit 1 (zero matches) |
| JSON-LD author | `"name":"Angad Singh"` present (`url` `https://segwise.ai/blog/author/angad-singh`) |

### Step 2 — repo anchors (current `origin/main` tip `8824abc8`)

| Check | Result |
|---|---|
| `rg -n "screenshot evidence and change alerts" app/routes/marketing.tsx` | hits at lines 38 (hero) and 755 |
| `rg -n "every 3–6 hours" app/routes/marketing.tsx` | hits at lines 167, 229, 1327 |
| `rg -n 'SUPPORT_EMAIL = "support@0509\.io"' app/lib/support.ts` | line 13 |
| `rg -c "0509\.in" app/routes/marketing.tsx` | exit 1, zero hits |

### Step 3 — remaining URLs HTTP 200

| URL | Result |
|---|---|
| `https://segwise.ai/blog/author/angad-singh` | 200 |
| `https://segwise.ai/blog` | 200 |
| `https://segwise.ai/privacy-policy` | 200 |
| `https://0509.io/` | 200 |
| `https://0509.io/search` | 200 |
| `https://0509.io/auth/signup` | 200 |
| `https://0509.io/compare/magicbrief` | 200 |

## Owner step (unchanged since 2026-08-21)

The send remains blocked on the owner decision: LinkedIn message to Angad
Singh (recommended), or a verified Segwise vendor-facing inbox once one is
confirmed. Common patterns such as `hello@segwise.ai` / `support@segwise.ai`
stay unverified and must not be invented.

No repo-local outbound mail path exists for this pitch. The product's only
outbound sender is the production Worker's Cloudflare `send_email` binding
(`EMAIL_FROM_EMAIL: alerts@0509.io`, used for digests/alerts), which needs
production secrets/deploy and is not appropriate for a one-off vendor
pitch. `support@0509.io` exists in source (`app/lib/support.ts:13`) but is
not confirmed by the owner as the sender for this pitch.

Whether Nish already sent the pitch since 2026-08-21 is unknowable from
this workspace. The only observable signal is the live article (unchanged
on 2026-08-23) plus any author reply (invisible here).

Retirement criteria while the pitch sits unsent are undefined. The prepared
doc sets a ~2-week follow-up cadence after a send, but never says when this
item stops re-dispatching. Default: leave the item in rotation unless Nish
rules otherwise. This lane does not settle that.

## Files

- `docs/segwise-listing-2026-08-21.md` — one 2026-08-23 re-verification
  block added inside `## Submission status (recorded 2026-08-21)` only.
- `.lane/reports/0509-lane1-segwise-listing-reverify-20260823.md` — this
  evidence record (unique to lane 1).

No shared report files touched. No product code touched.

## Rollback

N/A — documentation-only; revert is a `git revert` of this lane's commit
if ever needed. The pitch is not sent by anything in this repo.
