# Detector bail-out audit — 2026-09-10

Issue #1538. Follow-up to the #1500 `lp_run_audit` instrumentation and the
#2157 reason-code recorder (`cta_pipeline_bail_reason_counts`).

## Data window and method

The reason-code recorder went live in production on 2026-09-10. This audit
reads the rows accumulated on that first day — the orchestrator's unblock
condition for this issue is "one day of `cta_pipeline_bail_reason_counts`
rows then ship from real D1 frequencies" (orchestrator sweep decisions of
2026-09-10), replacing the original "7 days of `lp_run_audit` Logpush lines"
wording now that the reasons land in D1 directly. The ranking below is the
real production distribution for 2026-09-10; if a later week shows a
materially different mix, this doc gets a dated revision, not an edit.

Query used (read-only, reproducible):

```sql
SELECT day, stage, reason, count
FROM cta_pipeline_bail_reason_counts
ORDER BY day, count DESC;
```

## Funnel for the day

| stage | count |
|---|---|
| checks_started | 125 |
| page_fetch_succeeded | 59 |
| dom_extracted | 59 |

125 checks, 59 produced a snapshot, 66 bailed — every one of them at the
fetch stage (`page_fetch_succeeded` is the stage a check fails to reach).
The volume paths (selection_enrichment, backfill, canary) do not run the
validity/diff/event stages, so no bail rows exist below fetch — that is the
recorder working as designed (#2077), not missing data.

## Top 5 bail-out reasons by frequency

All bails on 2026-09-10, stage `page_fetch_succeeded` — meaning the
plain-HTTP leg failed AND the browser-render fallback did not rescue:

| # | reason | count | share of bails |
|---|---|---|---|
| 1 | `landing_blocked` | 22 | 33% |
| 2 | `landing_http_error` | 18 | 27% |
| 3 | `landing_content_empty_or_oversized` | 18 | 27% |
| 4 | `landing_challenge_page` | 4 | 6% |
| 5 | `landing_fetch_failed` | 4 | 6% |

## Worked examples (real domain, real HTML, real bail)

Verified 2026-09-10 by fetching each domain with the pipeline's own
user-agent (`0509-bot/1.0 (+https://0509.io)`, `redirect: manual`).

1. **`landing_blocked` — `www.ajio.com`.** The origin (Akamai edge) answers
   the bot UA with HTTP 403 and a 369-byte block page:

   ```html
   <TITLE>Access Denied</TITLE>
   <H1>Access Denied</H1>
   You don't have permission to access "http://www.ajio.com/" on this server.
   Reference #18.b6163017.1789068643.941185a
   ```

   Same pattern at `stores.reliancesmartbazaar.com` (403 + nginx
   "403 Forbidden", 118 bytes). The status itself is the bail; the body is
   never the offer.

2. **`landing_http_error` — `vilvahstore.com/flat10%off`.** A real ad
   landing URL from the `ad` table; the origin's CDN edge answers 400:

   ```html
   <html><head><title>400 Bad Request</title></head>
   <body><center><h1>400 Bad Request</h1></center>
   <hr><center>cloudflare</center></body></html>
   ```

   Dead or malformed campaign URLs are the dominant shape here —
   `snapmint.com/offer/<expired>` returns a branded 404 page, and ad landing
   pages rot as campaigns end. The `#1538` split now tells these apart:
   `landing_not_found` (404), `landing_gone` (410), `landing_server_error`
   (5xx after the transient retry), `landing_http_error` for the rest.

3. **`landing_content_empty_or_oversized` — `www.brooklinen.com/collections/classic-percale-sheets`.**
   A real ad landing URL returning 200 with a **1,819,255-byte** body —
   nearly twice the 1,000,000-byte `MAX_LANDING_PAGE_HTML_BYTES` cap — so
   the fetch bailed on size alone. `www.milton.in` (3.2 MB) and
   `elevenlabs.io` (1.14 MB) bail the same way. The `#1538` fix keeps the
   first 1 MB and parses it: the title/CTA/price live near the top, so these
   pages now produce a snapshot with a `landing_content_truncated` warning
   instead of bailing. Only a 0-byte body still bails, under the narrower
   `landing_content_empty` code.

4. **`landing_challenge_page` — `discord.com`.** Returns 200 with real
   markup, but the HTML embeds the Cloudflare challenge loader
   (`cdn-cgi/challenge-platform/scripts/jsd/main.js`), which the
   capture-validity gate fingerprints — the extracted signals would come
   from the interstitial, not the offer. `auth.openai.com` shows the
   canonical "Just a moment" + `_cf_chl_opt` variant (served at 403 there,
   so it books as `landing_blocked`; at 200 it books as
   `landing_challenge_page`).

5. **`landing_fetch_failed` — `www.gymfits.in`.** A real ad landing URL
   whose domain no longer resolves: `curl: (6) Could not resolve host`. The
   fetch throws before any status exists; after the one transient retry it
   is a `landing_fetch_failed` bail. `adspy.uk` fails the same way by
   timeout (no answer inside the 12 s bound).

## What shipped against the top 3 (this PR)

- **`landing_blocked` → `landing_auth_required` for 401.** A 401 is a login
  wall, not a bot wall — a rendered leg fetches the same URL and gets the
  same auth screen, so the render attempt is now skipped for 401 (and for
  the dead-URL statuses below). Splitting it out keeps `landing_blocked`
  meaning "bot wall (403)", which is the population a render can actually
  rescue.
- **`landing_http_error` → `landing_not_found` / `landing_gone` /
  `landing_server_error`.** Dead ad URLs (404/410) now book separately from
  a site outage (5xx, still retried once first) and from unnamed 4xx.
  404/410 also skip the rendered leg: a rendered error page can carry a
  real-looking CTA, which would be a phantom proof, not a rescue.
- **`landing_content_empty_or_oversized` → truncated-parse +
  `landing_content_empty`.** The body is now read up to the cap and parsed;
  oversized pages emit their fields instead of disappearing, marked with
  `landing_content_truncated` in `captureWarningCodes`. A genuinely empty
  body reports `landing_content_empty`.

All three fixes carry unit tests under `tests/unit/landing-page-extractor/`.

## Canary

`scripts/canary-cta-detector.mjs` now alarms on rate, not only on silence:
below 1 `landing_page_cta_changed` event per 25 active watchlists in the
window fails the check (integer compare, `events * 25 < watchlists`), in
addition to the original zero-event guard. The zero-event guard still
fires today — 0 `landing_page_cta_changed` events all-time — which is the
silence the instrumentation exists to explain: the funnel shows the
detector never gets far enough to emit one, and the bail ranking above is
the why.
