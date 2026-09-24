import { expect, test, type Page } from "@playwright/test";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "../app/routes";

interface MotionFinding {
  selector: string;
  reason: string;
  // For duration leaks: the value the browser is actually running.
  duration?: string;
}

// Routes visited by the spec. Reuses the walker from e2e/console-clean.spec.ts
// so the reduced-motion coverage stays in lockstep with the route surface —
// a new screen gets a motion assertion for free, and a route whose file ends
// in `.ts` (an API/resource route, not a screen) is skipped the same way.
function screenPaths(entries: RouteConfigEntry[], parent: string): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.file.endsWith(".ts")) continue;
    const path = [parent, entry.path].filter(Boolean).join("/");
    if (entry.path !== undefined) paths.push(path);
    if (entry.children) paths.push(...screenPaths(entry.children, path));
  }
  return paths;
}

function visitPath(path: string): string {
  if (path === "*") return "/placeholder";
  return `/${path.replace(/:[^/]+/g, "placeholder")}`;
}

const targets = ["/", ...screenPaths(routes, "").map(visitPath)];

// The two assertions the browser can answer honestly:
//
//   1. `document.getAnimations()` returns no running or pending CSS / WAAPI
//      animations on the page. A transition is *not* an "animation" in the
//      Web Animations sense — it is a CSS transition — so this only catches
//      `animation:` keyframes and `Element.animate(...)`. The global reduced-
//      motion block in `app/app.css` already drops `animation` to `none`, so
//      in practice this set should be empty.
//
//   2. Every element in the document has `transition-duration: 0s` AND
//      `animation-duration: 0s` in its computed style. The global block
//      applies `transition: none !important`, which the browser reports as
//      `transition-duration: 0s` for `all`. This is the assertion that
//      catches `Element.animate(...)` calls and inline `style="..."` that
//      tries to override the global reset.
//
// Both checks are run per route. The control test at the bottom of this file
// visits the same routes WITHOUT reduced motion and asserts the computed
// durations are non-zero on at least one element — so an always-green spec
// that proves nothing fails there instead.
async function inspectMotion(page: Page): Promise<MotionFinding[]> {
  return page.evaluate(() => {
    const findings: { selector: string; reason: string; duration?: string }[] = [];
    const label = (element: Element) =>
      `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`;

    // `subtree: true` is the part that matters. Without it a running
    // animation inside a shadow root (Base UI dialog, sonner toast) is
    // invisible to the check and the route passes for the wrong reason.
    for (const animation of document.getAnimations({ subtree: true })) {
      const target = animation.effect?.target as Element | null | undefined;
      findings.push({
        selector: target ? label(target) : "(detached)",
        reason: `running animation (playState=${animation.playState})`,
      });
    }

    // `transition: none !important` is what `app/app.css` pins under
    // `prefers-reduced-motion: reduce`. The computed longhands are the only
    // way to prove the cascade actually won: a `duration-180` utility
    // declares a non-zero `transition-duration` in the same origin, and only
    // the important universal reset can beat it back to `0s`.
    //
    // The value is a comma-separated list (`transition-property: all` with
    // several properties), so every entry is checked, not just the first.
    const nonZero = (value: string) =>
      value
        .split(",")
        .some((part) => Number.parseFloat(part) > 0);

    const everyElement = [...document.querySelectorAll("*"), document.documentElement];
    for (const element of everyElement) {
      const cs = getComputedStyle(element);
      if (nonZero(cs.transitionDuration)) {
        findings.push({
          selector: label(element),
          reason: "transition-duration non-zero",
          duration: cs.transitionDuration,
        });
      }
      if (nonZero(cs.animationDuration)) {
        findings.push({
          selector: label(element),
          reason: "animation-duration non-zero",
          duration: cs.animationDuration,
        });
      }
    }
    return findings;
  });
}

for (const target of targets) {
  test(`${target} honours prefers-reduced-motion on first paint`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });

    const response = await page.goto(target);
    // The status check is the same one the console-clean spec does: a 404 on
    // the unmatched `*` route is expected and not a failure of the spec, but
    // a 5xx is — motion checks on a broken page mean nothing.
    const status = response?.status() ?? 0;
    if (status >= 500) {
      throw new Error(`${target} returned ${status}; motion assertions skipped on a broken page`);
    }

    // networkidle is what the rest of the e2e/ suite uses; animations that
    // start after networkidle would still be in `getAnimations()`. This
    // gives us one steady-state sample.
    await page.waitForLoadState("networkidle");

    const findings = await inspectMotion(page);

    // A screenshot proves the route actually rendered. On the unmatched
    // route (status 404) the body is empty — that's fine, the motion
    // assertion is what the issue asked for, and a still page is a
    // trivially motion-free page.
    await testInfo.attach(`reduced-motion-${target}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    expect(
      findings,
      `${target} (${testInfo.project.name}): ${findings.length} motion findings — first: ${JSON.stringify(findings[0])}`,
    ).toEqual([]);
  });
}

// End-state assertions: opening the capture-pair sheet and toggling a brand
// switch must produce the same visible state regardless of whether motion is
// reduced. The whole point of "honoured" is "the user can still use the
// thing"; a transition being stripped is fine only if the final state lands.
test("the capture-pair sheet opens instantly under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto("/design/capture-plates");
  expect(response?.status()).toBe(200);

  const plates = page.locator("[data-slot='capture-plate']");
  await expect(plates).toHaveCount(3);

  await plates.nth(0).click();
  const pair = page.locator("[data-slot='capture-pair']");
  // No `toHaveCount(1)` wait, no `waitForAnimation` — the assertion is that
  // the pair is visible the same tick the click lands. With motion disabled
  // there is no enter transition to wait out.
  await expect(pair).toBeVisible();

  // The pair is rendered, and `getAnimations()` is empty even after the
  // click — the click itself does not start a transition that the global
  // block forgot about.
  const findings = await inspectMotion(page);
  expect(findings, `after click: ${JSON.stringify(findings[0])}`).toEqual([]);

  // And the final state matches what the non-reduced run produces.
  await expect
    .poll(async () =>
      pair.locator("img").evaluateAll((images) =>
        images.map((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toEqual([true, true]);
});

test("the brand switch toggles under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const response = await page.goto("/design/brand-switch");
  expect(response?.status()).toBe(200);

  const kindred = page.getByRole("switch", { name: "Kindred tracking" });
  await expect(kindred).toHaveAttribute("aria-checked", "true");

  await kindred.click();
  await expect(kindred).toHaveAttribute("aria-checked", "false");

  const kindredRow = page
    .locator("[data-slot='brand-switch-row']")
    .filter({ hasText: "Kindred" });
  await expect(kindredRow).toHaveAttribute("data-state", "off");
  await expect(kindredRow).toContainText("paused 22 Sept · history kept");

  const findings = await inspectMotion(page);
  expect(findings, `after toggle: ${JSON.stringify(findings[0])}`).toEqual([]);
});

// Control assertion: without reduced motion, the switch thumb carries a
// non-zero `transition-duration` (`duration-180` -> 180ms). A spec that
// always reports "no motion found" because of a broken selector or a stale
// page snapshot would still be green on the assertions above — this one
// proves the inspection is actually looking at the live styles. If the
// non-reduced visit lands with all-zero durations too, the assertions
// above are vacuous and this file's PR should not merge.
test("control: the switch thumb has a non-zero transition-duration without reduced motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const response = await page.goto("/design/brand-switch");
  expect(response?.status()).toBe(200);

  // The switch thumb is the element the brand-switch.tsx component pins at
  // `[&_[data-slot=switch-thumb]]:duration-180`. That utility is what we
  // expect the global reduced-motion block to neutralise.
  const thumb = page.locator("[data-slot='brand-switch-row'] [data-slot='switch-thumb']").first();
  await expect(thumb).toBeVisible();

  const duration = await thumb.evaluate((el) => getComputedStyle(el).transitionDuration);

  // Tailwind compiles `duration-180` to `180ms`; the browser reports it as
  // `"0.18s"`. Either non-zero form is acceptable; `0s` is the failure.
  const numeric = parseFloat(duration);
  await testInfo.attach("control-thumb-duration", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(
    numeric,
    `expected switch thumb transition-duration > 0 without reduced motion, got "${duration}"`,
  ).toBeGreaterThan(0);
});
