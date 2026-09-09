## fix(switch): land free-preview CTAs on a tracked demo search, not the vendor domain

Closes #2123.

### What changed

Every in-scope "Try the free preview" CTA now lands on a `/search` for a
tracked demo brand (`nike.com`, first entry of `DEMO_BRAND_PAGE_DOMAINS`),
whose production `/search` returns 14 verified ads — instead of the vendor's
own domain, which renders "0 ads found" and spends the one impression on an
empty wall.

- **Switch pages** (`/switch/panoramata`, `/switch/visualping`): new optional
  `previewSearchDomain` field on `SwitchPage` (typed to the demo-brand
  fixture) drives the CTA query in `switch-landing.tsx`. `ctaBrand` still
  holds the vendor domain for copy that names the vendor
  (`competitor-monitoring` kicker) — copy may name the vendor, the search
  query must not.
- **Sitemap-canonical compare pages** (`/compare/visualping-ad-libraries`,
  `/compare/foreplay-spyder`, `/compare/panoramata`): the preview form ships
  a pre-filled demo search (`defaultValue={FREE_PREVIEW_SEARCH_DOMAIN}`), so
  "Try it free, no account" submits to `/search?website=nike.com` without
  typing; the closing "search preview" body link targets the same non-empty
  search instead of a bare `/search`.
- **Panoramata** uses the demo-competitor pattern (the issue's preferred
  option) rather than the conditional vendor-domain carve-out.
- **MagicBrief is deliberately untouched**, per Nish's note on #2123
  (2026-09-09T06:27Z): MagicBrief is being wiped in #2127 — do not fix the
  MagicBrief CTA. `/switch/magicbrief` and `/compare/magicbrief` keep their
  existing CTAs until that wipe lands. The new test encodes the scope
  exclusion with that reason.
- `FREE_PREVIEW_SEARCH_DOMAIN` is exported from
  `app/lib/demo-brand-pages.ts` (derived from the existing fixture — no new
  list, no new pipeline, no tool). No migrations, no workflow files.

### Verification

Real run on the claim worktree (`origin/main..HEAD`, base f5e9163c):

- `vitest run --project node`: **639 files, 7556 tests passed** — including
  the new `tests/switch-preview-cta.test.tsx` (5 cases) and the updated
  `tests/switch-pages.route.test.ts`.
- `vitest run --project workers`: **42 files, 206 tests passed**.
- `npm run typecheck` (cf-typegen + react-router typegen + `tsc -b`): clean.
- `sgscan --base origin/main`: no new security findings.
- Live production checks (pre-fix state, motivating the change):
  `https://0509.io/search?q=visualping.io` renders "0 ads found";
  `https://0509.io/search?q=nike.com` renders "14 ads found / 14 verified";
  `https://0509.io/search?website=nike.com` renders "14 verified" — the CTA
  targets chosen here all return verified rows today.
- eslint was attempted and **failed** (`Cannot find package 'eslint'` — the
  repo does not declare eslint as a dependency; no `lint` script or workflow
  gate exists). Pre-existing scaffold gap, not introduced by this diff; the
  repo's gates (both vitest projects, typecheck, sgscan) are green.
- The issue's post-deploy termination script (`/switch/*` + `/compare/*`
  last `/search` href non-empty and non-vendor, destination ≥1 verified) is
  covered locally by the new test's href assertions and lands live after
  merge + deploy.

### run-proof

`origin/main..HEAD`: 8 files changed (169 insertions, 5 deletions). No new
`bin/` files, no timed units/timers/workflow files touched, no migrations.
Proof of run is the full vitest suites above (node 7556 green, workers 206
green), `npm run typegen`/`tsc -b` clean, and `sgscan` clean on the diff.

research: not applicable — no new `bin/` files added.
help-first: not applicable — no new `bin/` files added.

net-positive-because: the +164 lines are one regression test (~100), one fixture-derived constant with docs, and the CTA edits themselves; no new pipeline, tool, or mechanism — machinery count is flat while the conversion guard tests go up.

organ-heartbeat: app/routes + app/lib + app/components not-an-organ: marketing-surface diff touches no organ paths (gate SKIP: no fleet organ touched in the diff).

loose-ends: none in scope — switch CTA href, compare pre-filled form, compare body link, fixture constant, and regression test all ship; live curl termination checks land automatically after merge + deploy.

### Reviewer round

(pending — filled after the one reviewer round)
