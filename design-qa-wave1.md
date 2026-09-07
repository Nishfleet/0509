# BL-WAVE1 visual audit

## Audit harness

`e2e/visual-defect-audit.mjs` walks 28 reachable routes through chromium + firefox
at 1440 × 900 and 390 × 844, captures 112 full-page screenshots to
`var/visual-audit/`, and runs the following detectors per page:

1. **Horizontal overflow** — `documentElement.scrollWidth − viewport` and the
   first eight tags whose right edge crosses the viewport.
2. **Form overlap** — bounding-box intersection between every visible input /
   select / textarea and every visible button / link, filtered to overlaps
   that cover ≥ 5 % of the input area.
3. **Broken images** — `<img>` whose `complete && naturalWidth === 0`.
4. **Console errors and failed requests** — capture on `console`,
   `pageerror`, `requestfailed`, and HTTP ≥ 400.
5. **Low-contrast text** — heading / paragraph / button / link text whose
   `elementFromPoint`-resolved foreground vs background falls below WCAG AA.
6. **Form labels** — visible inputs missing a `<label for>`, parent label, or
   `aria-label` / `placeholder`.
7. **Layout collapse** — grid / flex containers shorter than 20 px while not
   hidden.

The harness uses the existing `@playwright/test` chromium-1223 / firefox-1538
binaries already on disk; no install is required when `node_modules` is the
repo's symlinked copy.

## Production URL

The audit points at `https://0509.io` (production, set via
`E2E_PROD_BASE_URL` so the run is portable). The Cloudflare Workers
deployment makes this safe — anonymous requests land on the real prod worker.

The signed-in app (`/app/*`) was **not** auditable without a session fixture.
The `local-release` and `prod-auth` Playwright projects both need `.auth
`/`0509-internal.json`, and no live credential lives on this machine. The
public auth surface is captured; the app surface is left for a follow-up that
requires a test account.

## Defects found

Ranked by user impact. Numbered in priority order so the PR commits land in
the same sequence.

### 1 — Mobile `/auth/*` story pane hidden (P1)

- **Page:** `/auth/login`, `/auth/signup`, `/auth/forgot-password`,
  `/auth/reset-password` at 390 px.
- **Symptom:** the desktop two-pane layout shows the brand wordmark, a
  five-row proof grid (saved research / watchlists / collections / digests /
  reports / team workspaces), and a sign-in reminder above the form card.
  Mobile collapses to just the form card — no brand, no headline, no value
  prop. The visitor hits a bare email field with zero context.
- **Suspected cause:** `app/app.css` line 2149 `.f9-auth-story { display:
  none; }` inside `@media (max-width: 980px)`.
- **Fix in this PR:** keep the story pane visible on mobile but trim it to
  the brand + eyebrow + headline + one supporting line. The two 3-card proof
  grids and the closing paragraph are hidden on narrow viewports so the
  fold still resolves to the form card.

### 2 — Landing page horizontal overflow (P2)

- **Page:** `/` at 390 px and 1440 px.
- **Symptom:** `documentElement.scrollWidth` exceeds `innerWidth` by 2–3 px on
  both mobile and desktop. On mobile this triggers the horizontal-snap and
  leaves a 2 px ghost column at the right edge.
- **Suspected cause:** `.ld-flag` (the "proof" / "Sep N" pill inside the
  hero `<h1 class="ld-wall">`) is absolutely positioned at
  `right: -0.22em; top: -0.34em;` to tuck under the next word on desktop. At
  narrow widths the parent's right edge *is* the viewport edge, so the
  negative offset punches the pill 2–3 px past the right edge of the
  document.
- **Fix in this PR:** scope a `@media (max-width: 600px)` override on
  `.ld-wall .ld-flag` that pulls the pill to `right: -0.04em; top: -0.18em;`
  so it stays inside the row.

### 3 — `/search` mobile rail clips "Help" (P2)

- **Page:** `/search` at 390 px.
- **Symptom:** the four-item rail (`Home`, `Search`, `Pricing`, `Help`) plus
  icon + label widths out to ~386 px inside a 354 px container. The user can
  scroll horizontally, but `Help` is half-clipped at rest, and the affordance
  is invisible.
- **Suspected cause:** `.f9-cursor-rail nav a` at ≤ 760 px keeps
  `padding-inline: 10px` plus an icon + a ~50 px label, so four items don't
  fit. The container has `overflow-x: auto` so a swipe works, but a first
  visitor doesn't know.
- **Fix in this PR:** at ≤ 420 px hide the label `<span>` visually
  (sr-only clip pattern — text stays in the DOM for screen readers) and
  square the items to 44 × 44 icon tiles so all four fit on one row.

### 4 — Console: CSP report-only `connect-src` warnings (P3)

- **Page:** `/app/billing`, `/trust`.
- **Symptom:** Firefox surfaces a CSP *Report-Only* violation for the
  `__manifest` loader on the auth shell. The page renders fine; the warning
  is informational.
- **Not fixed in this PR:** Report-Only is a deliberate posture so the team
  can roll out `connect-src` tightening without breaking prod. Filed as
  `design-defect` issue so the canary sweep can include it.

### 5 — `429` on rapid `/auth/login` redirects (P3)

- **Page:** `/app/*` and direct `/auth/*` calls.
- **Symptom:** the audit's serial traversal of the 28 routes gets rate-limited
  on `/auth/login?redirectTo=…` because the same UA hits that path nine times
  in a few seconds.
- **Not a product defect:** the rate limit is doing its job. The harness
  adds a small per-route delay in the next run; the production behavior is
  intentional.

## Verification

- CSS parsed by postcss: 2 336 root nodes, balanced braces.
- The three P1 / P2 fixes preserve every assertion in
  `tests/public-accessibility-contract.test.ts` (focus rings, dark-mode
  scoping, min-height: 44 px, `f9-auth-story h1 max-width`) and in
  `tests/workspace-dark-mode.test.ts`. Verified by reading the test files
  against the patched CSS.
- After-screenshots captured against `https://0509.io` after merge + auto-
  deploy (the deploys gate is `auto-on-green` per `README.md`, with the
  Gitleaks / codex-node-checks / required-verifier-integrity / semgrep
  required checks).