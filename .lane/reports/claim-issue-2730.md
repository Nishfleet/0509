# Lane evidence — claim/issue-2730 (AdCreative fbcdn-proxy contract lock)

Issue: Nishfleet/0509#2730 — lock the fbcdn-proxy contract with a regression
test and close the two raw-URL gates the #2401 review left open
(`http://*.fbcdn.net`, apex `https://fbcdn.net`).

## What changed

- `app/lib/creative-edge-cache-url.ts`: new `isFbcdnCreativeUrl` — the
  raw-render gate. True for ANY URL the browser resolves to an fbcdn host
  (apex or `*.fbcdn.net`, http, https, or scheme-relative). The edge-fetch
  gate `isEdgeCacheableCreativeUrl` stays strict (https + subdomain only) —
  `tests/creative-edge-cache.server.test.ts` asserts `http://x.fbcdn.net`
  still yields no route URL, and the server re-applies it per redirect hop.
  Fixed the stale `buildCreativeResourceUrl` docstring ("falls back to the
  raw URL" — it does not; fbcdn never renders raw).
- `app/components/ads/ad-creative.tsx`: `src` is now
  `isFbcdnCreativeUrl(storedUrl) ? buildCreativeResourceUrl(...) : storedUrl`
  — any fbcdn shape goes proxy-or-mock; non-fbcdn hosts still render as
  stored (no open-proxy drift).
- `tests/ad-creative.test.tsx` (new): renderToStaticMarkup assertions —
  https fbcdn emits `src="/creative/<metaAdId>"` with no `fbcdn` byte in the
  markup; http/apex/scheme-relative fbcdn and unusable `metaAdId` all render
  the mock with no `<img>`; non-fbcdn URL still renders as-is; direct
  predicate coverage for lookalike hosts (`evil-fbcdn.net`,
  `fbcdn.net.attacker.test`).

## Verification

- `npx vitest run --configLoader runner --project node tests/ad-creative.test.tsx tests/creative-edge-cache.server.test.ts` → 26/26 pass (2026-09-11).
- Mutation check: `git checkout HEAD -- app/components/ads/ad-creative.tsx` + same vitest run → 3 failures, each a raw fbcdn `<img src>` (http, apex, scheme-relative) — the test bites. Fix restored, re-ran green.
- `npx vitest run --configLoader runner --project node --changed origin/main` → 68 files, 692 tests pass.
- No `migrations/**` or `tests/integration/**` touched → workers project not run. Typecheck left to CI per repo AGENTS.md.
