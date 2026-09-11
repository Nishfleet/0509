# BET 5 crawlability receipt — sitemap sweep 2026-09-11

Issue: Nishfleet/0509#2882. Read-only sweep; no workflow files touched.

## Sitemap sweep (195 URLs)

- Source: https://0509.io/sitemap.xml (195 `<loc>` entries on 2026-09-11, up from ~19 on 2026-08-25).
- Method: sequential `curl -s -o /dev/null -w '%{http_code} %{size_download}'` per URL, browser UA, with per-URL retry/backoff. Body size recorded to detect empty pages (`size_download <= 100` counts as empty).
- Result: **195/195 returned HTTP 200 with non-empty HTML** (smallest body ~6.3 KB; timeline detail pages ~6.3–6.6 KB, ads/timeline index pages larger). Zero non-200, zero empty bodies.

### Non-200 / empty list

None. No follow-up fixes filed.

### Rate-limit observation (important for the termination command)

The site rate-limits bursts from a single IP: after roughly 150 requests/minute from one address, Cloudflare starts returning **429 with a ~15 KB rate-limit page** for a short window, then recovers on its own (confirmed: every 429 URL returned 200 on retry after a quiet window, 2× re-verified).

The termination check as written (`for u in $(curl …); do curl … "$u"; done`) issues 195 back-to-back requests with no spacing and **will trip this 429 window mid-run**, producing false FAIL lines. The sweep above passed with ~1 s spacing and up-to-6 retries with 3 s backoff per URL. A verified Googlebot request is served from Cloudflare's edge under normal bot handling, so this is a client-burst artifact, not a crawlability defect — but anyone re-running the raw termination command should expect transient 429 FAILs that clear on retry.

## [NISH] Search Console step (requires login — worker has no credentials)

- [ ] Open Google Search Console → 0509.io property.
- [ ] Confirm/refresh submission of `https://0509.io/sitemap.xml` (Sitemaps section); record date of last submission/read.
- [ ] Record indexed-page count (Pages report).
- [ ] Record impressions for at least one non-branded query (Performance report, filter out brand terms).
- [ ] Paste the three numbers below and tick BET 5's termination check, or name the block.

```
GSC sitemap submitted/last-read date:
GSC indexed pages:
Non-branded impressions (query, count, date range):
```

BET 5 termination is fully proven only after this section is filled. The crawlable-surface half (sitemap ≥ its URLs all 200/non-empty) is receipted above.
