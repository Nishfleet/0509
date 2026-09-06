## Summary

- Programmatic buyer surfaces (`/ads/:domain`, `/compare/*`, `/switch/*`, `/sneaker-resale`, `/competitor-monitoring`) shared one generic `og:image` — `https://0509.io/og-image.png` — making link cards indistinguishable across ~40 pages (issue #1572).
- Extends the existing SVG og:image machinery (not a new image-generation service) with a stateless `/social-card/...` endpoint and an optional `ogImageUrl`/`ogImageAlt` override on `publicSeoMeta`, so each surface stamps a branded card while site-wide surfaces keep the generic fallback.
- `/ads/:domain` card carries the brand name + Ad Aggression Score as query params (`n`, `s`); `/compare/*` and `/switch/*` cards name both tools; `/sneaker-resale` and `/competitor-monitoring` use their cluster headline.
- No D1 migration. No new image-generation service. Cards are stateless SVGs; the ads card carries its data in query params so the renderer never reads D1.

## What stayed generic

`/`, `/pricing`, `/trust`, `/help`, `/docs`, `/status`, `/changelog`, `/privacy`, `/terms` still stamp `https://0509.io/og-image.png` — they call `publicSeoMeta` without the override.

## Files

- `app/lib/seo.ts` — `publicSeoMeta` accepts optional `ogImageUrl` + `ogImageAlt`; four pure URL builders (`adsSocialCardUrl`, `compareSocialCardUrl`, `switchSocialCardUrl`, `clusterSocialCardUrl`).
- `app/lib/social-cards.server.ts` — new stateless SVG card renderer served under `/social-card/{ads,compare,switch,cluster}/...`. Reuses the site-wide gradient + text recipe; XML-escapes all text.
- `workers/app.ts` — serves `/social-card/...` through the existing `publicFileResponse` helper, before the rate-limit gate.
- `app/routes/ads.$domain.tsx` — branded card with brand name + score (or no score when aggression is deferred).
- All `compare.*.tsx` routes — "Five to Nine vs <Tool>" card.
- `app/components/switch-landing.tsx` (`switchPageMeta`) — "Switch from <Tool>" card.
- `app/routes/sneaker-resale.tsx` + `$locale.sneaker-resale.tsx` — cluster card.
- `app/routes/competitor-monitoring.tsx` — cluster card.

## Verification

- `npm run typecheck` — clean (exit 0).
- `npm test` — 6891 node tests + 128 worker tests pass (576 + 23 test files).
- `npm run build` — succeeds.
- `tests/social-cards.test.ts` (33 tests): override fallback, URL builders, path parser, SVG rendering (ads/compare/switch/cluster), XML escaping, every compare route stamps a non-generic `/social-card/compare/` og:image + alt, every switch route stamps `/social-card/switch/`, sneaker-resale + competitor-monitoring stamp cluster cards, `/ads/:domain` meta stamps branded card with/without score.

run-proof: `npm test` (6891 node + 128 worker) green; `npm run typecheck` exit 0; `npm run build` exit 0; `tests/social-cards.test.ts` 33/33 pass.

Closes #1572
