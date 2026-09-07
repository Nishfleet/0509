## BET 9 hero redesign — termination test at issue path

The BET 9 hero redesign is already live on `/`: the H1 names the buyer and the job ("Growth teams who track competitors know the offer before the call"), the live-proof mechanic sits in a demoted strip beneath the headline, the mobile stack keeps the search input + CTA above the 390px fold, and the 2px `ld-ticker-belt` overflow is closed. This PR lands the issue's exact termination test path `tests/hero-fold.spec.ts` by moving the existing `tests/design/hero-viewport.spec.ts` gate there and repointing the `chromium` / `mobile-chromium` projects at it. Net **-1 file**.

### Acceptance criteria
- Three directions (safe / bold / weird-but-plausible) as real HTML pages at 1440px, screenshotted — `docs/design/hero-directions/` (`01-safe.html`, `02-bold.html`, `03-weird-but-plausible.html` + desktop/mobile PNGs, `CHOSEN.md` = Safe).
- H1 names the buyer and the job — `app/routes/marketing.tsx` `heroWall`.
- Live-proof mechanic demoted to a proof strip beneath — `heroProofStrip`.
- Mobile stack compressed so input + CTA above fold — `app/app.css` `@media (max-width: 600px)`.
- 2px `ld-ticker-belt` overflow fixed — `.ld-ticker` `contain: inline-size` (issue #1860).

### Verification
- `npx playwright test tests/hero-fold.spec.ts` → **2 passed** (chromium 1440×900, mobile-chromium 390×844) against live `https://0509.io`, zero console errors, no horizontal overflow. Screenshots written to `test-results/design/hero-fold-{desktop-1440,mobile-390}.png`.
- `vitest run --project node` → **598 files / 7120 tests passed**.
- `sgscan` → no new security findings.

### run-proof
- Termination command `npx playwright test tests/hero-fold.spec.ts` exits 0 at both viewports (proven above).
- `chromium` / `mobile-chromium` projects now match `tests/hero-fold.spec.ts`.

### Review (reviewer seat: cursor/cursor-grok-4.6-high)
- **Act on:** none.
- **Consider:** screenshot output path kept `test-results/design/` after the spec moved out of `tests/design/` — applied, now `test-results/hero-fold-{desktop-1440,mobile-390}.png`.
- **Noted:** doc-comment tension (gate asserts a specific `BUYER_JOB_H1` regex while claiming "not any specific string") is pre-existing and unchanged by this diff.
- **Dismissed-with-reason:** vitest would pick up the new `.spec.ts` (node project `include` only matches `*.test.ts`/`*.test.tsx` + one integration spec); bare termination command runs extra projects (only `chromium`/`mobile-chromium` set `testDir: ./tests`); stale references to the old path (none remain).

Closes #1898
