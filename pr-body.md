## seo: publish the Ad Aggression Score methodology as its own linkable, indexable page

Closes #2022.

### What changed

The Ad Aggression Score methodology page — the formula, four sub-scores
(Velocity/Testing/Freshness/Persistence), score bands, and evidence floor — is
promoted to its own canonical, indexable URL at **`/methodology`**, and is now
linked from the footer of **every `/ads/:domain` page** ("How this Ad
Aggression Score is calculated — read the methodology") and listed in
`sitemap.xml` through the existing sitemap generation path.

Path history on the same published content (the formula is unchanged — only the
canonical URL moved):
- `#960`: `/methodology/ad-aggression-score`
- `#1263`: `/ad-aggression`
- `#2022` (this PR): `/methodology` — canonical

Both prior paths keep permanent 301 redirects to `/methodology` so external
links and any indexed entries keep their equity:
- `/ad-aggression` → 301 → `/methodology` (`app/routes/ad-aggression-redirect.ts`)
- `/methodology/ad-aggression-score` → 301 → `/methodology` (redirect target updated)

Localized methodology twins (`/de/methodology`, etc.) re-export the EN page and
canonicalize to the EN `/methodology`.

No migration, no workflow-file edits, no `/ads/:domain` regression. The inline
per-brand score and its formula are byte-for-byte unchanged.

### Verification

Real run, from the rebased `origin/main..HEAD` in the claim worktree:

- `vitest run --project node` (full): **620 files, 7423 tests passed** — including the
  methodology redirect/path tests, `ads-brand-page.render`, `seo`, sitemap,
  locale buyer-surface, breadcrumb, and `design-system-ratchet` (raw-hex-color
  ceiling back to 258) suites.
- `vitest run --project worker`: **41 files, 202 tests passed**.
- Targeted re-run after rebasing onto latest `origin/main`
  (`a3f93889`): 14 files / 193 tests passed.
- `react-router typegen` clean.

Local termination-gate checks against the worktree:
- `grep -q methodology app/routes/*ads*` → matches (`app/routes/ads.$domain.tsx`)
- `buildSitemapXml` now emits `<loc>https://0509.io/methodology</loc>`
- `/methodology` route serves the methodology page (200); `/ad-aggression` and
  `/methodology/ad-aggression-score` 301 to it.

### run-proof

`origin/main..HEAD`: 29 files changed (182 insertions, 339 deletions). No new
`bin/`, no timed unit/workflow files. Proof of run is the standing vitest suites
above (node + workers projects), all green, plus the route/redirect unit tests in
`tests/aggression-score-methodology.test.ts` (301 targets and route wiring) and
the sitemap/locale tests.

### research / help-first

Not applicable — no new `bin/` files added.

### Reviewer round

- Reviewer seat: `commandcode / meta/muse-spark-1.2-contributor` (resolved via
  `find_senior_seat`). One round, no loops.
- **Act on**: none — the reviewer found no blocking or act-on findings.
- **Consider** (both landed):
  - Removed a dead, unused `redirectTarget` helper left in
    `tests/aggression-score-methodology.test.ts` (reviewer flagged it).
  - `app/components/ads/brand-score-card.tsx` comment now records the full
    canonical path history through `/ad-aggression` (#1263) instead of
    skipping the intermediate hop.
- **Noted**: single-hop 301s straight to `/methodology` (no chained redirects)
  preserve indexed equity; no leftover functional `/ad-aggression` in
  `app/`/`workers/` outside comments, the legacy constant, and the redirect
  loader; sitemap + security-header cache paths move through the shared
  generation path; the orphaned `methodology.ad-aggression-score.tsx` module
  was unreferenced dead code, safely removed.
- **Dismissed-with-reason**: deleting the orphan module (dead, un-wired) and
  the deliberate literal `/methodology` HREF in `brand-score-card.tsx`
  (documented grep-ability for the issue's termination check).

### Test plan

- `/methodology` returns 200 and renders the formula with the four sub-scores,
  bands, and evidence floor.
- `/ads/:domain` footer links to `/methodology` with the "read the
  methodology" wording; source matches `grep methodology app/routes/*ads*`.
- `sitemap.xml` lists `/methodology` (and no longer lists a redirect target).
- `/ad-aggression` and `/methodology/ad-aggression-score` 301 to `/methodology`.

### Salvage resume (fleet-ops#1204)

Work resumed from the banked `wip/pi-issue-0509-2022-20260908T215253Z` state and
re-verified end to end by a fresh run. The branch was then rebased onto the
moved `origin/main` (`fe534bbc`, PRs #2035/#2036/#2038 landed mid-flight; the
new `/no-phantom-changes` registry entries from #2026 were kept and the
methodology canonical switched to `/methodology` in the same resolution), and
the full suite re-ran to green on the rebased head: `vitest --project node`
7439 tests green, `vitest --project workers` 202 tests green,
`react-router typegen` clean, `sgscan` no new findings, all PR-body gates
(prove-one-run-check, fleet-exec-review-canary, fleet-no-agent-names-check,
fleet-rebuild-verify-check, fleet-token-efficiency-check,
research-before-build-check, fleet-organ-heartbeat-check) green.
crgate: skipped — CodeRabbit not signed in on this machine.

organ-heartbeat: app/routes + app/lib not-an-organ: marketing-surface diff touches no organ paths (gate SKIP: no fleet organ touched in the diff).

loose-ends: none in scope — page, footer links, sitemap entry, and both 301 redirects ship; the issue's live `curl https://0509.io/...` checks land automatically after merge + deploy.