# Plan — `/llms.txt` indexable timeline entries (issue #1929)

Manager mode (heavy). Reuse the same indexable timeline set that `publicSitemapFile` emits in `/sitemap.xml`. Existing static fallback (no D1, demo, missing `landing_page_snapshot`) must keep working byte-for-byte. Stay in scope — only the three files the issue body names: `workers/app.ts`, `app/lib/public-markdown.ts`, `tests/public-markdown.test.ts`.

## Goal
Make `/llms.txt` list the same indexable `/timeline/:domain` URLs the sitemap does, without adding locale-prefixed variants, inventing a new cap, or breaking today's static fallback.

## Acceptance-driven phases

- [x] phase 1: markdown layer — in `app/lib/public-markdown.ts` add a pure `llmsPageForTimelinePath(path, lastmod?)` mirroring `llmsPageForBrandPath` (regex `^\/timeline\/([^/]+)$`, returns `null` for `/timeline/`, `/de/timeline/x`, `/timeline/x/y`); extend `buildLlmsText(brandEntries = [], timelineEntries = [])` to a second optional arg, default `[]`; render a new `Timelines:` block under `Pages:` with one `- [${domain} offer timeline](${canonicalUrl(path)}): Offer timeline for ${domain} with dated offer states from public captures, last captured on ${lastmod}.` line per sitemap-emitted entry; skip entries whose path does not match the regex (defence in depth, bullet 5b); bound the section by the imported `SITEMAP_TIMELINE_PATH_LIMIT` from `app/lib/sitemap.server` (no new cap, bullet 6); only emit the `Timelines:` header when at least one entry survived filtering so `LLMS_TEXT = buildLlmsText()` stays byte-identical (bullet 5c).
- [x] phase 2: worker wiring — in `workers/app.ts` import `loadIndexableTimelineEntries` next to `loadIndexableBrandPageEntries`; in the `/llms.txt` branch replace the single `await loadIndexableBrandPageEntries(env)` with `await Promise.all([loadIndexableBrandPageEntries(env), loadIndexableTimelineEntries(env)])` and pass the tuple into `buildLlmsText` (bullet 1); the existing no-`DB` / no-table degradation inside `loadIndexableTimelineEntries` keeps the branch from 500ing (bullet 3).
- [x] phase 3: unit test — in `tests/public-markdown.test.ts` add four tests: (a) `/timeline/:domain` entry renders with newest-capture date + skips non-qualifying paths + keeps `LLMS_TEXT` byte-identical on the empty-arg call (acceptance 5a/5b/5c); (b) exactly one blank line between the `Timelines:` block and `Current product truth:`; (c) section is capped at `SITEMAP_TIMELINE_PATH_LIMIT` entries (acceptance 6) with filter-first slice order verified; (d) brand-page contract is unchanged when timelines are also passed.
- [x] phase 4: verification — full `vitest --project node` (602 files / 7173 tests, green); typecheck on the changed files is clean (the pre-existing e2e/playwright errors are not introduced by this diff); no D1 / no `landing_page_snapshot` / demo fallback stays byte-identical to today's static funnel (`buildLlmsText() === LLMS_TEXT`).

## Files to Modify
- `app/lib/public-markdown.ts` — new `llmsPageForTimelinePath`, second `timelineEntries` arg on `buildLlmsText`, new `Timelines:` block in the rendered output, `SITEMAP_TIMELINE_PATH_LIMIT` import.
- `workers/app.ts` — `/llms.txt` branch calls both readers via `Promise.all` and forwards both to `buildLlmsText`.
- `tests/public-markdown.test.ts` — four new tests covering acceptance 5a/5b/5c, acceptance 6 (cap), spacing between sections, and brand-page surface preservation.

## New Files
None.

## Risks
- `app/lib/public-markdown.ts` is imported by the worker and tests but not by client routes; importing `SITEMAP_TIMELINE_PATH_LIMIT` from `app/lib/sitemap.server` stays server-side (no client-bundle contamination).
- `LLMS_TEXT` byte-identity depends on the `Timelines:` header being suppressed when `timelineEntries.length === 0` AND no entry matches the regex — guard with a single conditional, do not emit the header at all in the empty path.
- Locale prefixes (`/de/timeline/x`, `/ja/timeline/x`) are naturally excluded by the single-segment regex `^\/timeline\/([^/]+)$` — no separate denylist needed (bullet 4).
- The `linkedPaths.length === SITEMAP_PATHS.length` assertion in the existing "real link list" test stays the byte-identity canary for bullet 5c; the new test re-asserts `buildLlmsText() === LLMS_TEXT` directly so a regression surfaces as a clean failure.
- `loadIndexableTimelineEntries` already returns `SitemapEntry[]` with `lastmod`; no change to `sitemap.server.ts` is required — keeps the diff to one producer + one consumer.
- The new section uses the existing `canonicalUrl` so URL shape cannot drift from sitemap.xml.

## Out of scope (deliberately not touched)
- `app/lib/sitemap.server.ts` — the issue's verify command asserts that whatever the sitemap emits, llms.txt emits the same set. The sitemap's loadIndexableTimelineEntries already returns the right set; modifying its SQL (`ORDER BY`/`WHERE`/`LIMIT`) or its per-domain grouping would change its output and is **not** what issue #1929 asks for. Those are bugfixes for a different issue.
- `app/lib/offer-timeline.server.ts` (`TIMELINE_SNAPSHOT_LIMIT` export) — only consumed by sitemap internals; no consumer of llms.txt needs it.
- `app/lib/ads-internal-links.server.ts` — unrelated comment.
- `tests/sitemap.server.test.ts` — the timeline-related tests are tied to sitemap-internal logic; the diff must not delete or rewrite them.
