# Lane evidence — claim/issue-2089

Issue: Nishfleet/0509#2089
Branch: `claim/issue-2089`
Agent: claude-vps

## What changed

- `app/lib/social-cards-raster.server.ts` — switched font imports from `?raw` to `?inline` and added a `dataUriToBytes` helper that decodes the Vite base64 data URI so resvg receives uncorrupted `Uint8Array` font buffers. The rasterizer still runs only in the worker entry.
- Removed `tests/integration/probe-raster.integration.test.ts` — it was a diagnostic with a placeholder assertion and did not prove font behavior after the fix.
- Strengthened `tests/integration/social-card-raster.integration.test.ts` by asserting the PNG is larger than 10 KB, which fails if resvg drops the `<text>` nodes.

## Why

The first implementation commit on this branch already changed `/ads/:domain` and `/timeline/:domain` social card og:image URLs to `.png` and rasterized the SVG source. The salvage commit added embedded Inter fonts, but Vite's `?raw` import corrupted the `.ttf` bytes (raw length was 419002 vs. the file's 420428 bytes). resvg then silently discarded every `<text>` node and shipped a blank gradient PNG. Using `?inline` gives a clean base64 data URI, and decoding it with `atob` produces the exact TrueType bytes needed for resvg's `fontBuffers`.

## Verification

### Unit + route metadata tests

```
npm run typecheck    # exit 0
npx vitest run --configLoader runner --project node tests/social-cards.test.ts
# 41 passed
npx vitest run --configLoader runner --project workers tests/integration/social-card-raster.integration.test.ts
# 2 passed
```

### Full suite

```
npm test
# node: 648 files, 7690 tests passed, coverage v8
# workers: 45 files, 216 tests passed

npm run build
# bundle size check passed: Total Upload 12.14 MiB
```

### Local end-to-end (0509 E2E server)

```
npm run e2e:serve:local

curl -fsS http://127.0.0.1:4179/api/health
# {"status":"ok","app":"0509",...}

curl -fsS -o /tmp/verify-0509/ads-card.png -w "content-type=%{content_type}\nhttp=%{http_code}\nbytes=%{size_download}\n" \
  "http://127.0.0.1:4179/social-card/ads/nike.com.png?n=Nike&s=72"
# content-type=image/png
# http=200
# bytes=171354

curl -fsS -o /tmp/verify-0509/timeline-card.png -w "content-type=%{content_type}\nhttp=%{http_code}\nbytes=%{size_download}\n" \
  "http://127.0.0.1:4179/social-card/timeline/nike.com.png?n=Nike"
# content-type=image/png
# http=200
# bytes=176658

curl -L -fsS "http://127.0.0.1:4179/timeline/nike.com" | grep -o 'property="og:image" content="[^"]*"'
# property="og:image" content="https://0509.io/social-card/timeline/nike.com.png?n=Nike"

curl -L -fsS "http://127.0.0.1:4179/timeline/nike.com" | grep -o 'property="og:image:type" content="[^"]*"'
# property="og:image:type" content="image/png"

# Legacy .svg alias still works and also returns PNG bytes
curl -fsS -o /tmp/verify-0509/timeline-card-legacy.svg -w "content-type=%{content_type}\nhttp=%{http_code}\nbytes=%{size_download}\n" \
  "http://127.0.0.1:4179/social-card/timeline/nike.com.svg?n=Nike"
# content-type=image/png
# http=200
# bytes=176658
```

Server was stopped with `kill -- -$(ps -o pgid= -p $(cat /tmp/verify-0509/server.pid) | tr -d ' ')`.

### Touched files

- `app/lib/social-cards-raster.server.ts` — font loading fix
- `app/assets/fonts/Inter-Bold.ttf` — embedded bold weight
- `app/assets/fonts/Inter-SemiBold.ttf` — embedded semibold weight
- `tests/integration/social-card-raster.integration.test.ts` — integration coverage with size assertion
