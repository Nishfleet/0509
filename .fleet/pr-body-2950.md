Closes #2950.

## What changed
Anonymous, cookie-free GETs of the public marketing HTML are now served from a named Cloudflare edge cache (`caches.open("public-html-edge-v1")`), closing the gap where `cache-control: public, max-age=300` (PR #360) was stamped but never consumed by any cache. This re-introduces the #2388 document cache that #2716 deleted, with #2716's removal condition satisfied structurally: the stored copy is a NONCE-FREE variant of the fully-secured response — its `script-src` keeps every host token but swaps the per-request `'nonce-…'` for `'sha256-…'` hashes computed from the very body stored, so header and body agree by construction and no nonce is ever shared between visitors. There is exactly one anonymous document shape: the first anonymous visitor receives the same variant.

- `workers/edge-cache.ts` (new): eligibility gates (GET/HEAD, cookie-free, the `PUBLIC_CACHEABLE_HTML_PATHS`/`PREFIXES` which include `/` and the marketing pages), (path, cf-ipcountry, deploy-version) cache keys, 5-minute TTL cap, quote-aware inline-script extraction + sha256 hashing, CSP rewrite, fail-open everywhere — a cache/body/hash failure degrades to the plain render, never a 5xx.
- `workers/app.ts`: cache lookup after the rate-limit gate (anonymous funnel counters keep their rows; a HIT skips the render); eligible HEADs render through a GET-ified request so the stored copy is full-body (#2393 headOf pattern); the nonce'd render is what `storeEdgeCache` receives and it returns the nonce-free variant it stored.
- Invalidation on deploy: the wrangler `version_metadata` binding gives every deploy a fresh version id, so a new deploy never replays a previous deploy's hashed asset manifest (2026-07-13 asset-skew class); 5-minute TTL stays as a second defense.
- Proof surface: `x-0509-edge-cache: HIT|MISS|BYPASS*` stamped on every response through this path (name deliberately differs from the retired `x-0509-cache`), asserted by the new deploy gate `scripts/check-live-public-home.mjs` (second-request HIT + nonce-free script-src + MISS/HMS timings).
- Tests: `tests/worker-edge-cache.test.ts` (independently computed hashes, eligibility, HEAD-after-warm-GET, version-change re-arm, truth-in-stamping, fail-open), `tests/edge-cache-removed.test.ts` (#2716 detector) stays green untouched.

## Verification (real runs)
- `npx vitest run --configLoader runner --project node --changed origin/main` → 9 files / 93 tests passed (run twice: before and after the origin/main merge).
- Targeted: `tests/worker-edge-cache.test.ts` + `tests/edge-cache-removed.test.ts` + `tests/worker-public-content-signal.test.ts` + `tests/worker-security-headers.test.ts` → 4 files / 51 tests passed.
- `sgscan --base origin/main` → No new security findings (exit 0).
- Branch merged origin/main (compare/guides pages, `/switch/adspy` eligibility) with zero conflicts; merged-tree suites re-run green.
- Live proof (`x-0509-edge-cache: HIT` on the second request, MISS/TTFB delta) executes via the new deploy-gate check at deploy time — not runnable pre-merge because the routes don't exist in prod; verified locally by the unit/integration-style workerd tests instead.

## Reviewer round (one round, senior seat: poolside/laguna-s-2.1-free)
- **Critical:** none — "Every acceptance criterion traces to working code"; the #2716 detector verified satisfied by independent grep.
- **Act on:** none (no Critical, no warning judged blocking; the reviewer's own verdict: "nothing here blocks. Merge, deploy, then click the homepage once logged-out").
- **Consider:** MISS path loses streaming because the sha256 CSP needs the finished body — cold responses get slower, warm get much faster (intrinsic to the design, stated here); the deploy gate prints TTFB improvement but does not assert it (log-only evidence accepted); if the zone ever enables Rocket Loader it would recreate inline scripts and break hash-CSP while the gate stays green (needs one live post-deploy hydration check — loose-ends); the extractor hashes only `type="module"`/no-type scripts, so a future `type="text/javascript"` would silently lose its hash (today the app emits only the covered kinds).
- **Noted:** country×version key fragments a per-colo cache (correctness-first; no Tiered Cache configured, so honest hit rates will be far below the gate's demonstration); `max-age=0` pins still cache 300s and the Cache-Control rewrite drops other directives (none relied on today); if `BASE_SCRIPT_SRC` ever gains `'strict-dynamic'` the variant breaks — a future one-line coupling test would lock it.
- **Dismissed-with-reason:** adding `/compare/*` + `/guides/*` to the cacheable set in this PR — the reviewer filed it under Suggestions; after the origin/main merge `/switch/adspy` is already eligible via main, the compare/guides pages went live yesterday and deserve their own verified bake, and the eligibility check is exact-path/prefix based (locale variants need a decision first). Recorded as a loose-end below.

run-proof: vitest node project --changed origin/main, 9 files / 93 tests green, run twice

run-proof: targeted 4-file / 51-test suite green

run-proof: sgscan --base origin/main clean

run-proof: #2716 detector untouched and green

run-proof: live HIT and TTFB proof wired into the deploy gate

run-proof: scripts/check-live-public-home.mjs defers that proof to deploy by design
net-positive-because: every anonymous visitor of /, pricing and the marketing pages stops paying the full Worker render (0.7-3.8s TTFB cold) once per 5 minutes per (colo, country); zero new machinery — one module + two-line hook in the existing fetch handler, fail-open, and the #2716 #2388-removal condition honoured rather than re-fought
research: not applicable (no bin/ files added)
help-first: not applicable (no new bin/ files)
rebuild-verify-check: not applicable (no rebuild/masking diff)
organ-heartbeat: not applicable (no organ/workflow files touched)
loose-ends: after deploy, one logged-out click of the homepage to confirm hydration under hash-CSP (zone Rocket-Loader question the reviewer could not verify from this repo); /compare/* and /guides/* remain no-store until their own eligibility entry lands; deploy-gate TTFB improvement is printed, not asserted
