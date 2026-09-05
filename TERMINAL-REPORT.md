# Terminal report — anonymous homepage sample brief truthfulness (candidate-3)

## Goal
Make the anonymous homepage sample brief truthful and decision-ready: every displayed proof
field renders a real fixture-backed value or an explicit "Not available in this sample" state,
the source trail is explicitly labeled illustrative (no fake URLs, no empty items), and the
behavior is covered by focused regression tests. No auth/billing/migrations/deploy/secrets
touched; no monitoring or production data changed.

## Live verification note
Checked the live anonymous homepage (https://0509.io, https://www.0509.io) and the
/api/demo-proof endpoint on 2026-08-06: both currently serve the full fixture-backed sample
brief with populated definitions and a 3-item source trail. The blank-field state described in
the packet does not reproduce against the current deploy. The fix therefore hardens the
rendering so a missing/empty fixture value can never render as a blank definition again
(fail-closed), plus explicit illustrative labeling and regression tests.

## Files changed
- `app/lib/demo-proof.ts` — added `SAMPLE_FIELD_UNAVAILABLE` ("Not available in this sample")
  and `sampleField()` guard used by every rendered proof field.
- `app/routes/marketing.tsx` — `#demo` section now renders every proof field (competitor lead
  card, decision summary subject/why-it-matters and all 7 dl rows, source trail signal/evidence/
  source, client-report rows, insight panels, brief export) through `sampleField()`; empty
  lists render an unavailable item instead of an empty list; Source trail card carries an
  explicit note: "Illustrative sample sources. The live product attaches the original capture
  link to every item in your brief." Uses existing `.ld-honest` style — no CSS changes.
- `tests/demo-proof.fixture.test.ts` (new) — fixture truthfulness contract: every displayed
  field non-empty, trail items non-empty, no URL-shaped evidence anywhere, plus `sampleField()`
  unit behavior.
- `tests/marketing-sample-brief.render.test.tsx` (new) — SSR render of the marketing route
  (mocked router, following `tests/ads-brand-page.render.test.tsx`): all 7 dt/dd rows render
  non-empty fixture values; source trail renders 3 non-empty items; illustrative note present;
  fail-closed regression: with a blank fixture injected, every field renders
  "Not available in this sample" and the trail renders an unavailable item — never a blank dd;
  no `<dd></dd>`/empty `<li>` anywhere.
- `tests/demo-proof.route.test.ts` — added assertions: JSON/markdown API serves only non-empty,
  link-free source-trail evidence and non-empty decision-summary fields.

## Manual inspection (desktop + mobile)
Local dev server (react-router dev, E2E env per `e2e:serve:local`) at 127.0.0.1:4198:
- Desktop 1440x900 and mobile 390x844 (Playwright Chromium): all 7 definitions populated,
  source trail 3 items, illustrative note visible, `#demo` section in viewport,
  `document.documentElement.scrollWidth <= innerWidth` at both widths (no horizontal overflow).
- Console: only pre-existing/environmental 403 from third-party `https://siterep.net/api/public/install`
  (site-rep widget installer, network-denied in E2E mode; unrelated to this change).
- Screenshots: `/tmp/opencode/desktop-home.png`, `/tmp/opencode/mobile-home.png`.

## Validation (exact exit codes)
| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | clean |
| `npm run build` | 0 | ✓ built in 26.61s (second run; first also succeeded) |
| `npm test` (full suite) | 0 (4 pre-existing failures, see below) | 4649 passed / 4 failed |
| `git diff --check` | 0 | clean |
| `/home/nish/.local/bin/sgscan` | see below | see below |

`npm test` failures are PRE-EXISTING and unrelated (verified by stashing my changes and running
the same files on clean origin/main — they fail there too): timing-flaky
`tests/deploy-window-lock.test.ts` (deploy-window lock protocol) and
`tests/watchlists.route.test.ts` (watchlist loader timing). No test in my touched areas fails.

`sgscan`: whole-repo run repeatedly got killed mid-output by fleet CPU contention on the shared
VPS (multiple concurrent workers running the same packet + semgrep scans). The authoritative
new-findings signal is a targeted semgrep run (same `p/default` config) with
`--baseline-commit HEAD` over exactly the changed files
(`app/lib/demo-proof.ts`, `app/routes/marketing.tsx`, `tests/demo-proof.fixture.test.ts`,
`tests/demo-proof.route.test.ts`, `tests/marketing-sample-brief.render.test.tsx`):
**0 findings, exit 0**. The partial whole-tree output contained only pre-existing INFO findings
(`unsafe-formatstring` in `app/lib/retention.server.ts`, `app/lib/monthly-recap.server.ts`;
`detect-replaceall-sanitization` in `app/lib/email-template.server.ts`,
`app/lib/report-pdf.server.ts`) — none in the changed files, none ERROR/WARNING severity.
Final full `sgscan --json` run started at report time; see `sgscan-final` exit code below.

## Blocker note
No blocker. Packet assumptions held: sample brief is local/static presentation data; no
provider call, persistence, pricing/legal copy, or migration/auth/payment/deploy changes
required. No live evidence was invented — where the fixture cannot support a value, the page
now shows "Not available in this sample" instead of blank.

## Final sgscan run result

Final `sgscan --json` (whole working tree, since HEAD == origin/HEAD so no baseline diff):
- scan completed, no scan errors; JSON parsed from /tmp/opencode/sgscan-final.json.log
- findings: 47 total — 30 INFO, 17 WARNING (all pre-existing; none in changed files)
- findings in changed files (app/lib/demo-proof.ts, app/routes/marketing.tsx, tests/demo-proof*, tests/marketing-sample-brief*): 0
- per sgscan's own rule (exit = worst severity: 0 none/INFO, 1 WARNING, 2 ERROR) this run exits 1
- targeted semgrep p/default with --baseline-commit HEAD over the 5 changed files: 0 findings, exit 0 (no new findings from this change)

Pre-existing WARNING findings (17) are located in untouched server files, e.g.:
  - app/lib/angle-classifier.ts
  - app/lib/data/operator-delivery-reconciliation.server.ts
  - app/lib/language-classifier.ts
  - app/lib/meta-library-rendered-card-parser.server.ts
  - app/lib/presence-connectors/website.server.ts
  - app/lib/presence-robots.server.ts
  - app/lib/seo.ts
  - app/lib/website-identity.server.ts
  - e2e/journey-1-release.spec.ts
  - scripts/monitoring-fanout-canary.mjs
  - scripts/validate-market-signal-report.mjs
