Fix the 2px horizontal overflow that the `ld-ticker-belt` marquee used to leak on 390px viewports (issue #1486). The containment was already present in `app/app.css` (`.ld-ticker { overflow: hidden; max-width: 100%; contain: inline-size; }`) — this PR verifies it and ships the regression test that locks it, so the belt's `width: max-content` marquee can never again inflate `documentElement.scrollWidth`.

Verified live (2026-09-05, real Chromium, 390x844 against https://0509.io/):
- `documentElement.scrollWidth === clientWidth === 390` (overflow 0)
- `.ld-ticker` rect `left=0 right=390 width=390` — clipped to the viewport
- `.ld-ticker-belt` internal scrollWidth 2829, fully contained by the clipping container, does not contribute to page width
- desktop (1440px) ticker renders unchanged (same `ld-roll` animation, same items, aria-hidden decorative belt)

Tests:
- `npx vitest run --configLoader runner --project node tests/design-system/mobile-overflow.test.tsx` → 1 file, 3 tests pass
- `npx vitest run --configLoader runner --project node tests/marketing-rebuild.test.ts` → passes (CSS not regressed)
- Mutation-checked the new test: removing `contain: inline-size` from `.ld-ticker` makes it fail immediately, proving the guard fires.

run-proof: the no-horizontal-scroll contract is enforced in a real browser by the existing release e2e `e2e/home-hero-viewport.spec.ts` (→ `expectNoHorizontalOverflow`) and the bet9 first-viewport canary; both measure `scrollWidth === clientWidth` at 390px.

Verification:
- `npx vitest run --configLoader runner --project node tests/design-system/mobile-overflow.test.tsx` → 3 passed
- Mutation check (removed containment) → test fails as expected, then restored
- `sgscan` → no new security findings
- `node repro against production` → overflow 0 at 390px

net-positive-because: prevents horizontal-scroll regression on the highest-traffic landing surface without touching layout, markup, or the marquee animation.

Note: the local `crgate` gate is unavailable on this machine (CodeRabbit is not authenticated here); the repo's own CI gates run on the PR.

Closes #1486
