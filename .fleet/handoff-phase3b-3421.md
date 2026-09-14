# Handoff — phase 3b for issue #3421 (worker: complete phase 3b extremely well)

Worktree: /home/nish/workspaces/agent-worktrees/issue-0509-3421 (branch claim/issue-3421 — already rebased, do NOT rebase, do NOT push).

Plan file: .fleet/plan-3421.md — phases 1–2 ticked. Phase 3's tests were written against the
WRONG casing contract and phase 3 is now split: 3b = the slug-casing correction below, 3c =
final verify-to-green (same worker run is fine).

## Manager decision you must implement verbatim (the why — do not re-litigate)

Issue #3421 pins the slug as EXACT: `/guides/can-ChatGPT-monitor-competitor-ads` (uppercase
ChatGPT). But `workers/canonical-path.ts` (issue #2955, pinned by
tests/canonical-path.test.ts) 301s EVERY uppercase public GET path to lowercase, and
`renderSitemapXml` lowercases every `<loc>`. So the mixed-case URL can never serve 200 — it
redirects to `/guides/can-chatgpt-monitor-competitor-ads`, and any canonical/og/JSON-LD
pointing at the mixed-case URL is a canonical pointing at a redirect (broken SEO contract).

Resolution — BOTH casings in the route table, lowercase everywhere canonical:

1. Lowercase `can-chatgpt-monitor-competitor-ads` is the SERVED canonical slug: it is what
   the sitemap `<loc>`, page canonical link, og:url, hreflang links, JSON-LD urls, hub card
   href, and all inbound links declare. It is also what the mechanical triple-agreement
   gate (tests/guides-routes.test.ts, regex `"\/guides\/([a-z0-9-]+)"`) can see — a
   mixed-case entry is invisible to that gate and would ship with ZERO protection.
2. The issue's EXACT mixed-case slug stays registered verbatim in app/routes.ts (EN +
   $locale) via tiny re-export shim files — the literal
   `route("guides/can-ChatGPT-monitor-competitor-ads", "routes/guides.can-ChatGPT-monitor-competitor-ads.tsx")`
   remains true, the URL resolves (301 → lowercase → 200), and no `{id}` option hacks are
   needed since the two registrations use distinct files.

## Exact edits

### A. Rename the two real modules to lowercase files

- `git mv "app/routes/guides.can-ChatGPT-monitor-competitor-ads.tsx" "app/routes/guides.can-chatgpt-monitor-competitor-ads.tsx"`
- `git mv "app/routes/\$locale.guides.can-ChatGPT-monitor-competitor-ads.tsx" "app/routes/\$locale.guides.can-chatgpt-monitor-competitor-ads.tsx"`
  (the filename starts with a literal `$` — quote it)

### B. Edit `app/routes/guides.can-chatgpt-monitor-competitor-ads.tsx`

- `const PATHNAME = "/guides/can-chatgpt-monitor-competitor-ads";` (lowercase — this feeds
  canonicalLinks, publicSeoMeta og:url, WebPage/Article JSON-LD, and the hreflang splat).
- Rewrite the header comment block (lines ~1-25) so it no longer claims "the uppercase
  ChatGPT in the PATH slug is deliberate" as the served form. New wording must state: the
  issue-specified slug `/guides/can-ChatGPT-monitor-competitor-ads` stays registered in
  app/routes.ts verbatim and 301s to this lowercase canonical under issue #2955 (one URL
  shape per public route — lowercase, no trailing slash, pinned by
  tests/canonical-path.test.ts); the signup-source marker stays lowercase.
- Keep ALL page copy, exports (`canChatGPTMonitorCompetitorAdsFaqEntries`,
  `guideSearchPreviewPath`), and the Form/source-marker exactly as-is. No copy changes.

### C. Edit `app/routes/$locale.guides.can-chatgpt-monitor-competitor-ads.tsx`

- import → `from "./guides.can-chatgpt-monitor-competitor-ads"`
- `canonicalLinks("/guides/can-chatgpt-monitor-competitor-ads")` and
  `buyerSurfaceHreflangLinks("guides/can-chatgpt-monitor-competitor-ads")` (lowercase —
  these URLs must serve 200, not 301).
- Update the header comment the same way as B (exact slug → 301 → lowercase canonical).

### D. New shim `app/routes/guides.can-ChatGPT-monitor-competitor-ads.tsx`

```ts
// Exact-slug registration for issue #3421 — the issue-specified slug keeps its
// uppercase ChatGPT. The worker's #2955 path canonicalization 301s every
// uppercase public path to the lowercase canonical before React Router runs,
// so `routes/guides.can-chatgpt-monitor-competitor-ads.tsx` is the module that
// serves the page; this file exists so the specified slug stays literal in
// the route table and still resolves if canonicalization is ever bypassed.
export {
  default,
  links,
  meta,
  canChatGPTMonitorCompetitorAdsFaqEntries,
  guideSearchPreviewPath,
} from "./guides.can-chatgpt-monitor-competitor-ads";
```

### E. New shim `app/routes/$locale.guides.can-ChatGPT-monitor-competitor-ads.tsx`

```ts
// Exact-slug registration for issue #3421 — see the EN sibling shim. The
// $locale cluster registers this verbatim so the specified slug resolves
// under every buyer-surface locale prefix as well.
export { default, links, meta } from "./$locale.guides.can-chatgpt-monitor-competitor-ads";
```

### F. `app/routes.ts` — four registrations (2 EN + 2 $locale), comments updated

EN block: keep the existing mixed-case line verbatim AND add the lowercase canonical line
right after it, e.g.:

```ts
  // Issue #3421: the eighth /guides/* page — the buyer's first-question
  // explainer. The issue-specified slug keeps its uppercase ChatGPT and 301s
  // to the lowercase canonical (issue #2955) — the lowercase registration is
  // the URL the sitemap, canonical, and every internal link declare.
  route("guides/can-ChatGPT-monitor-competitor-ads", "routes/guides.can-ChatGPT-monitor-competitor-ads.tsx"),
  route("guides/can-chatgpt-monitor-competitor-ads", "routes/guides.can-chatgpt-monitor-competitor-ads.tsx"),
```

$locale block: same pattern — keep `route("guides/can-ChatGPT-monitor-competitor-ads", "routes/$locale.guides.can-ChatGPT-monitor-competitor-ads.tsx")` and add
`route("guides/can-chatgpt-monitor-competitor-ads", "routes/$locale.guides.can-chatgpt-monitor-competitor-ads.tsx")` after it.

### G. Registries — all lowercase

- `app/lib/seo.ts` SITEMAP_PATHS: `"/guides/can-ChatGPT-monitor-competitor-ads"` →
  `"/guides/can-chatgpt-monitor-competitor-ads"` (comment may keep noting the exact-slug
  alias).
- `app/lib/locale-markets.ts` BUYER_SURFACE_GUIDE_PATHS: same lowercase swap.
- `app/lib/public-markdown.ts` LLMS_PAGE_DETAILS key: `"/guides/can-chatgpt-monitor-competitor-ads"`
  (the `_llmsDetailsCoverSitemap` mapped type keys off SITEMAP_PATHS — must match exactly).
- `app/routes/guides.tsx` GUIDE_ENTRIES href → `/guides/can-chatgpt-monitor-competitor-ads`.
- `app/routes/docs.tsx` `to="/guides/can-ChatGPT-monitor-competitor-ads"` → lowercase.
- `app/routes/competitor-monitoring.tsx` `to="/guides/can-ChatGPT-monitor-competitor-ads"` → lowercase.

### H. Tests

1. `tests/guides-can-ChatGPT-monitor-competitor-ads.route.test.ts` — KEEP THIS FILENAME
   EXACTLY (the issue's verify/termination commands name it verbatim). Update:
   - module imports → `~/routes/guides.can-chatgpt-monitor-competitor-ads` (the canonical
     module; the mixed-case import would resolve to the shim and still work, but pin the
     canonical).
   - `SLUG_PATH`/`CANONICAL` → lowercase; rename the constants' comments: the canonical is
     lowercase per #2955; the issue's exact slug 301s to it.
   - registration assertions → assert BOTH literals exist in app/routes.ts:
     `route("guides/can-ChatGPT-monitor-competitor-ads", "routes/guides.can-ChatGPT-monitor-competitor-ads.tsx")`
     AND `route("guides/can-chatgpt-monitor-competitor-ads", "routes/guides.can-chatgpt-monitor-competitor-ads.tsx")`
     (same for the `$locale.` pair).
   - sitemap assertion → `<loc>https://0509.io/guides/can-chatgpt-monitor-competitor-ads</loc>`
     present; assert the uppercase `<loc>` is ABSENT (renderSitemapXml lowercases every
     loc — pinned by tests/canonical-path.test.ts).
   - ADD a 301-contract assertion:
     `canonicalPathFor("/guides/can-ChatGPT-monitor-competitor-ads")` returns
     `"/guides/can-chatgpt-monitor-competitor-ads"` (import from `../workers/canonical-path`
     — same import tests/canonical-path.test.ts uses).
   - Update the describe-block comment to state the contract in one breath: exact slug
     registered verbatim + served lowercase canonical.
2. `tests/guides-routes.test.ts` — the "issue #3421" describe block: canonical/og/loc/
   `to=` assertions → lowercase; registration assertions → both literals; add the same
   301-contract assertion. All copy assertions stay.
3. `git rm tests/_probe-sitemap-3421.test.ts` — debug probe, not a contract test.

### I. Verify-to-green (bare vitest, NO --reporter flag, VITEST_MAX_WORKERS=2)

```
npx vitest run tests/guides-routes.test.ts tests/guides-can-ChatGPT-monitor-competitor-ads.route.test.ts
npx vitest run tests/section-parents.test.ts tests/guides-how-to-track.route.test.ts tests/canonical-path.test.ts tests/sitemap.server.test.ts
```

Both runs must be fully green. If a PRE-EXISTING assertion (outside this diff's new tests)
must be reshaped rather than extended, STOP and report — that is a plan amendment, manager
decides. Do not delete any pre-existing test.

## Rules

- No migrations, no D1, no gate-owned edits. Tests + the files listed above only.
- Bare vitest only, never --reporter, never --maxWorkers above VITEST_MAX_WORKERS=2, never
  coverage/typecheck/tsc (CI owns typecheck).
- When done: tick the phase-3/3b boxes in `.fleet/plan-3421.md`, commit as ONE commit
  `fix(growth): serve /guides/can-ChatGPT-monitor-competitor-ads at its lowercase canonical (phase 3b, #3421)`
  — do NOT push (manager pushes).
- Final message: what changed, the real verify output (paste the tail), anything the
  manager must know.
