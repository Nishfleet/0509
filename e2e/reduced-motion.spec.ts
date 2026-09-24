import { expect, test, type Page, type TestInfo } from "@playwright/test";
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

// A route is a URL, so it is full of `/` and `.`; both are path separators or
// awkward file names once the route becomes a screenshot filename. Collapse
// everything unsafe into a single dash so the report stays a flat directory
// instead of a tree that mirrors the route table.
function slug(target: string): string {
  return target.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
}

// `testInfo.attach({ body })` keeps the buffer in memory and never writes a
// file; only the `path:` form is persisted, which is what makes the
// screenshots a reviewer can actually open. Writing through
// `testInfo.outputPath()` keeps the file inside Playwright's output directory
// (so `preserveOutput` governs it) without adding a path that escapes it.
async function saveShot(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: { fullPage?: boolean } = {},
): Promise<void> {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: options.fullPage ?? false });
  await testInfo.attach(name, { path: file, contentType: "image/png" });
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
// Both checks are run per route under reduced motion. The non-reduced side
// of the contract — a transition that actually animates before the global
// block strips it — belongs to the component that owns the transition, so it
// lives with that component's spec rather than here.
async function inspectMotion(page: Page): Promise<MotionFinding[]> {
  return page.evaluate(() => {
    const findings: { selector: string; reason: string; duration?: string }[] = [];
    const label = (element: Element) =>
      `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}`;

    // `document.getAnimations()` takes no options — the `subtree` option only
    // exists on `Element.getAnimations()` — so a shadow root opened by a Base
    // UI dialog or a sonner toast would be invisible to it. Walk the tree,
    // descend into every shadow root, and collect per element instead. The
    // Set collapses the duplicates the document-level call shares with the
    // element-level ones.
    const animations = new Set<Animation>(document.getAnimations());
    const walk = (root: ParentNode) => {
      for (const element of root.querySelectorAll("*")) {
        for (const animation of element.getAnimations()) animations.add(animation);
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);

    for (const animation of animations) {
      const effect = animation.effect;
      const target = effect instanceof KeyframeEffect ? effect.target : null;
      findings.push({
        selector: target ? label(target) : "(detached)",
        reason: `animation present (playState=${animation.playState})`,
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

    // `querySelectorAll("*")` on a Document already includes the document
    // element (`<html>`) — it is a child of the document node — so this is
    // every element on the page, root included, without a special case.
    for (const element of document.querySelectorAll("*")) {
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

    // A screenshot proves the route actually rendered rather than returning
    // a blank shell that happens to have no motion. Viewport-only, not
    // fullPage: every screen on the route table, across both projects, is a
    // lot of report weight and the first screen is what "did this route render"
    // is asking.
    await saveShot(page, testInfo, `reduced-motion-${slug(target)}`);

    expect(
      findings,
      `${target} (${testInfo.project.name}): ${findings.length} motion findings — first: ${JSON.stringify(findings[0])}`,
    ).toEqual([]);
  });
}
