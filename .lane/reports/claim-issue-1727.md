# Lane evidence — claim/issue-1727 (Playwright 1.63.0 adoption)

Issue: Nishfleet/0509#1727 — "Upgrade to Playwright 1.63.0; add test locks for
D1/external shared resources; adopt ariaSnapshotJSON in ARIA gate; enable
trace ARIA+screen snapshots". Source: quality-research-weekly sweep
2026-09-06 §2 (`agent-state/0509-transformation/quality-first-recos.md`).

## Acceptance-criteria mapping

The issue's bullets were written against a generic Playwright layout; the
repo's real surfaces differ. Each bullet maps as follows:

| Issue bullet | Repo reality | Implementation |
|---|---|---|
| `@playwright/test ^1.63.0` | — | `package.json` + regenerated lockfile; installed tree is 1.63.0 across `@playwright/test`, `playwright`, `playwright-core`. |
| `trace.snapshots = { dom, aria, screen }` | `use.trace` was `retain-on-failure` | `trace: { mode: "retain-on-failure", snapshots: { dom: true, aria: true, screen: true } }` in `playwright.config.ts`. |
| "projects with test locks" | `lock` is a `TestDetails` field (test/describe level), not a project field | `lock: "d1"` on every spec that writes the shared local fixture D1 (journeys 1–6, `local-authenticated`, `bl037/038` captures, `watchlist-run-history`); `lock: "external-api"` on every spec that hits the live external production surface (`prod-public`, `prod-authenticated`, and the four `*.prod-public.spec.ts` files). |
| "accessibility project" with `use.reducedMotion/forcedColors/contrast` | no a11y project exists; the a11y scenario is journey-3's `digest-notifications-accessibility` loop; the surface-audit drives its own browser so project `use` cannot reach it | wrapped that loop in `test.describe("native WCAG 2.2 conditions")` with `test.use({ reducedMotion: "reduce", forcedColors: "active", contrast: "more" })` — scoped so the conditions apply only to the a11y scenario, not the whole journey or the contrast audit (forced colors would falsify contrast measurement). |
| "ARIA gate: replace toMatchAriaSnapshot YAML diff with ariaSnapshotJSON" | no `toMatchAriaSnapshot` gate exists (sweep §1.14.4 was a recommendation, never built); the repo's only ARIA snapshot is the release-evidence capture in `e2e/helpers/release-artifacts.ts` | switched the capture to `ariaSnapshotJSON()`; artifact is now `<prefix>-<viewport>-<state>.aria.json` with `contentType: application/json`; the manifest reporter validates it by strict `JSON.parse` instead of a YAML `parseDocument`. |
| "tap-target/overflow tests use :visible" | tap/overflow gates are `page.evaluate`-based; the only `:visible` uses were a design check + journey-6 nav links | all 13 `:visible` sites converted to `locator.visible()`. |
| "custom quality reporter injected via --add-reporter" | the repo's custom reporter (`playwright-release-manifest-reporter.mjs`) was baked into the config's strict `reporter` array — an override | `run-local-release-proof.mjs` now appends it via `--add-reporter=...`; the reporter's `strict` mode is its constructor default so the no-options flag form suffices. |

"ARIA JSON diff in PR comment" (issue termination) has no existing
mechanism — there is no PR-comment plumbing in this harness. The JSON
artifact attached to each release test is the machine-diffable, reviewable
surface the sweep asked for; building a new diff gate + comment bot would be
new machinery beyond this issue's scope.

## Verification

- `npm ls @playwright/test playwright playwright-core` → all `1.63.0`.
- `npx tsc -b` (with `NODE_OPTIONS=--max-old-space-size=6144`; machine was
  loaded, first run OOM'd at the default heap) → clean.
- `npx playwright test --list` → 434 tests across 31 files; lock/test.use
  details validate at load.
- `npx vitest run --project node` on
  `playwright-release-manifest-reporter`, `e2e-harness-security`,
  `cross-browser-workflow`, `release-experience` → 49/49 pass.
- Live smoke (chromium, `E2E_START_LOCAL_SERVER=1` on port 4199 — 4179 is
  held by another lane's worktree): journey-3 `digest-notifications-accessibility`
  × 3 viewports passed under the `test.use` WCAG conditions + `d1` lock;
  journey-6 `returns from dashboard to account and back (mobile)` passed with
  `.visible()` locators + `d1` lock.
- `--add-reporter=./scripts/playwright-release-manifest-reporter.mjs` on a
  real run: manifest reporter loaded next to `list`, instantiated strict by
  default, and wrote `test-results/smoke-manifest.json`.

Note: `playwright install` pulled `chromium_headless_shell-1243` (1.63) —
the `e2e:install` step covers this on CI.
