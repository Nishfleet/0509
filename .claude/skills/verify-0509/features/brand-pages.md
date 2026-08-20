# Brand pages — `/ads/:domain`

Public, anonymous, SEO acquisition pages. Route: `app/routes/ads.$domain.tsx`.

## Zero-cost constraint

Stated in the route header comment and enforced by the loader: the page renders ONLY from
existing D1 discovery cache via `loadBrandPageCacheSnapshot` (bounded reads). A public request
must never trigger live scraping, Browser Rendering, or Meta API calls, for any input. A
cache-read failure degrades to the honest shell, never a 500 and never a live fallback. The
cache-miss shell, demo-sourced entries, and entries older than 7 days always carry
`<meta name="robots" content="noindex">`.

## How users reach it

A search engine result, or a direct link. No account.

## How to drive it

```bash
curl -fsS 'http://127.0.0.1:4179/ads/nykaa.com' -o /tmp/verify-0509/ads-nykaa.html
curl -fsS 'http://127.0.0.1:4179/ads/never-checked.example' -o /tmp/verify-0509/ads-miss.html
grep -c "We haven't watched" /tmp/verify-0509/ads-miss.html
grep -c 'name="robots" content="noindex"' /tmp/verify-0509/ads-miss.html
```

## What proves success

- Both requests return 200.
- The honest cache-miss shell renders: eyebrow `Not watching <domain> yet`, `<h1>` beginning
  `We haven't watched <domain> yet — ` and continuing `here's what you'd wake up to.`, the CTA
  `Run a free live search →`, and an `Example — this is what a watched brand looks like` block.
- That page carries `<meta name="robots" content="noindex">`.
- No provider or network call appears in the server log for either request.

## Local honesty note

On the 4179 fixture server there is no `browser` binding and no Meta token, so the commercial
discovery provider resolves to `demo`, and `loadBrandPageCacheSnapshot` deliberately returns
`null` for a demo environment — a public page must never present sample data as a brand's real
ads. Every `/ads/*` domain therefore renders the honest shell locally, including `nykaa.com`,
even though `nykaa.com` is seeded in `discovery_cache_entry`. The populated brand-page state
(cached ad wall, aggression score, change timeline) can only be proven against production.

The meta description for the miss state is separate copy and reads
`We haven't checked <domain> recently. Run a free live Meta Ad Library search and track
<brand>'s ads with Five to Nine.` — do not assert it as the on-page heading.
