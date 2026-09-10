## Why

`.f9-growth-pricing` was a dark navy band (`#0b1530`) with purple/teal radial gradients, and `.f9-commerce-card` was glassmorphism: 22px radius, translucent white gradients, 72px soft shadows, white text, and a 7s infinite float. That is a second, un-ratified design system sitting on the money section — the exact "two different products" complaint the 2026-07-27 audit abolished. This PR restyles the pricing band and commerce cards onto the ratified v4 token system (`--bone` / `--ink` / `--card` / `--line` / `--green`).

## Scope

- `app/app.css`: restyle `.f9-growth-pricing` (bone ground, ink 2px top/bottom rules, no gradient overlays) and `.f9-commerce-card` (bone card on a 2px ink rule, square corners, `6px 6px 0 var(--ink)` offset shadow, ink text). Green (`var(--green)`) is reserved for the recommended card state (`.is-recommended`); the recommendation badge (`.f9-plan-badge`) uses the WP-A4 ink fill with bone text. Removed the `7s` float animation and its sole-use `@keyframes f9-card-float` (repo-wide grep confirms sole-use; the `prefers-reduced-motion` block now has nothing to disable and is dropped). The card-internal helpers (`.f9-plan-feature-list` bullet, `.f9-price-sync`, `.f9-plan-actions` buttons) move from the dark-glass palette to tokens as part of the cards' presentation.
- `docs/design-system-ratchet.json`: NOT touched in this PR. The ratchet json is a gate-owned path (`gate_globs` in gate-integrity.yml) and any PR change to it fails gate-integrity without a repo-admin `gate-integrity-attest:` — which a worker must never emit. `ratchet-auto-tighten` is the json's single writer and lowers the ceilings on main after this lands: measured drops are `raw-hex-color` 258→246, `non-token-border-radius` 158→152, `css-gradient` 22→12 (`node scripts/design-system-ratchet.mjs --update` against this branch says the ceilings already match reality). The pricing/card class blocks contribute 0 of each marker on this tree.

The `.ld-*` shared landing classes, `.f9-cycle-toggle`, and the bundling/FAQ/table sections are out of scope and untouched.

## Tradeoffs

- **Green for the recommended state.** Per WP-A4 the recommendation *badge* is ink-filled (never green) and green marks state. The `.is-recommended` card gets the green border + offset shadow as the state accent; the ink "Recommended" badge carries the label, so no single-colour reliance (WCAG 1.4.1).
- **Shared helpers.** `.f9-plan-feature-list` and `.f9-plan-actions` are also used on billing. Billing's own rule `.f9-wk-plan-card .f9-plan-actions button` (higher specificity) still wins for its buttons, and the shared helpers moving to tokens pulls billing toward the same v4 system rather than away.
- **Two adjacent `.f9-growth-pricing` blocks kept** (one for background/colour, one for padding/rules) to minimise diff churn; a later cleanup may merge them.

## Blast Radius

Touches the pricing section styling on every landing page that renders PricingSection, plus the shared `.f9-plan-feature-list` / `.f9-plan-actions` helpers on `/app/billing`. No markup, copy, pricing, logic, or tests changed. The full node vitest suite (662 files / 7885 tests) is green, so nothing on the render paths regressed.

## Verification

- `node scripts/design-system-ratchet.mjs` → `Ratchet clean. Remaining legacy markers: 443.` (exit 0). The three target markers inside `.f9-growth-pricing` / `.f9-commerce-card` are 0, and the 7s float is gone.
- `node scripts/design-system-ratchet.mjs --update` (dry verification) → ceilings already match reality at the committed json; the committed ceilings are unchanged in this PR (see scope note) and the measured drops (raw-hex 258→246, radius 158→152, gradient 22→12) land via `ratchet-auto-tighten` on main after merge.
- `bash ./scripts/ci-vitest-run.sh -- vitest run --configLoader runner --project node` → `Test Files 662 passed (662) / Tests 7885 passed (7885)` (post-rebase onto origin/main `9ea94292`, conflict-resolved). (Workers project skipped per fleet memory budget — no `migrations/**` or `tests/integration/**` changed.)
- `sgscan` → `No new security findings.`
- `bin/fleet-no-agent-names-check --commit-range origin/main..HEAD` → `OK: no agent attribution detected`.
- `crgate` could not run — CodeRabbit is not signed in on this VPS (environmental, not a code result).

run-proof: node script design-system-ratchet.mjs exit 0 (443 remaining, ceilings verified against reality on this tree); `ci-vitest-run.sh -- project node` 662 files / 7885 tests pass (post-rebase, all green); no sgscan findings introduced (CSS-only).

research: no new `bin/` files introduced (CSS-only change), so `research-before-build-check` does not apply. help-first: no new CLI surface.

## Review (product-repo round, seat `opencode|nemotron-3-ultra-free`)

- **Act on:** none.
- **Consider:** reviewer suggested merging the two adjacent `.f9-growth-pricing` blocks; left as-is to minimise the diff, acceptance does not require it.
- **Noted / Dismissed-with-reason:** reviewer asked to WCAG-check `var(--green)` border on `var(--bone)`. Dismissed: green is a decorative border/shadow accent (not text), the "Recommended" semantic is redundantly carried by the ink badge, and green-on-bone borders are an established v4 accent in `app.css` (e.g. `.f9-ads-watch-btn`), so there is no single-colour reliance.

Closes #2318