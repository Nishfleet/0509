import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-030 live proof, captured from the local fixture harness.
 *
 * Opt-in: this writes ~30 full-page screenshots and sweeps 320-2560 for
 * horizontal scroll, which is far too slow for every local-auth run. Set
 * `BL030_CAPTURE=1` (and optionally `BL030_OUT=<dir>`) to produce the phase
 * evidence set.
 *
 * It captures the two rebuilt surfaces AND an untouched route, because the
 * program's coexistence claim — every surface whose phase has not landed keeps
 * running on the old system inside the new shell — is only a claim until
 * somebody photographs it.
 */
const ENABLED = process.env.BL030_CAPTURE === "1";
const OUT_DIR =
  process.env.BL030_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl030";
const PREFIX = process.env.BL030_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
const SURFACES = [
  { name: "overview", url: "/app", user: "e2e-agency" },
  { name: "overview-newuser", url: "/app", user: "e2e-free" },
  { name: "competitors-board", url: "/app/watchlists", user: "e2e-starter" },
  {
    name: "competitors-pane",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1",
    user: "e2e-starter",
  },
  // Round 3: the opened competitor's RECORD, scrolled to, is its own view and
  // gets its own budget. Each tab is captured because the owner's complaint
  // ("a busy box — where's the coherence?") was about what these five panels
  // looked like, not about the peek pane above them.
  {
    name: "detail-changed",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1",
    user: "e2e-starter",
    anchor: ".f9-ed-tabbar",
  },
  {
    name: "detail-evidence",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence",
    user: "e2e-starter",
    anchor: ".f9-ed-tabbar",
  },
  {
    name: "detail-delivery",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=delivery",
    user: "e2e-starter",
    anchor: ".f9-ed-tabbar",
  },
  {
    name: "detail-setup",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=setup",
    user: "e2e-starter",
    anchor: ".f9-ed-tabbar",
  },
  { name: "collections-untouched", url: "/app/collections", user: "e2e-agency" },
] as const;
const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560];

async function prepare(context: BrowserContext, baseURL: string, user: string, theme: string) {
  await context.addCookies([
    { name: "f9_e2e_fixture", value: user, url: baseURL, sameSite: "Lax" },
  ]);
  await context.route(`${baseURL}/**`, (route) =>
    route.continue({
      headers: { ...route.request().headers(), "x-0509-e2e-test-mode": "1" },
    }),
  );
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem("f9-theme", value as string);
    } catch {
      /* storage disabled — the boot script falls back to light */
    }
  }, theme);
}

/**
 * Counts EVERY painted green in the first viewport, not just this layer's own
 * `.f9-wk-ins` class.
 *
 * Round 1 measured `.f9-wk-ins` and reported "1 green mark" while BL-016's
 * setup card was still painting green-ink step stamps and green Rank-3
 * underlines on the same screen. The review called that overselling, and it
 * was: a probe that only looks at the classes you wrote can only ever confirm
 * what you already believe.
 *
 * Method (quoted in the build report):
 *  - Resolve every green token the stylesheet exposes — `--green`,
 *    `--green-ink`, `--green-wash`, `--ed-accent`, `--ed-accent-wash`,
 *    `--ed-accent-mark`, `--ed-focus`, `--wk-focus` — through a probe element,
 *    so `color-mix()` and aliases resolve to real computed colours.
 *  - ALSO flag any colour whose green channel dominates both others by >20,
 *    which catches a hardcoded green nobody routed through a token.
 *  - Scan every element intersecting the first viewport, skipping anything
 *    invisible (display/visibility/opacity/zero-box).
 *  - Read `color`, `background-color`, `background-image`, the four
 *    `border-*-color`s, `text-decoration-color`, `box-shadow`, `fill` and
 *    `stroke`. A border colour counts only when that border is actually
 *    painted (non-zero width, style not `none`); a decoration colour only when
 *    `text-decoration-line` is not `none`; a background colour only when its
 *    alpha is non-zero.
 *  - `outline-color` is collected SEPARATELY as `focusReservations`: a focus
 *    ring is not painted until focus lands, and a visible green focus ring is
 *    a sanctioned exception (it is a boundary, not a state marker).
 */
async function auditGreen(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.opacity = "0";
    document.body.appendChild(probe);
    const rootStyle = getComputedStyle(document.documentElement);
    const tokenGreens = new Set<string>();
    for (const token of [
      "--green",
      "--green-ink",
      "--green-wash",
      "--ed-accent",
      "--ed-accent-wash",
      "--ed-accent-mark",
      "--ed-focus",
      "--wk-focus",
    ]) {
      const raw = rootStyle.getPropertyValue(token).trim();
      if (!raw) continue;
      probe.style.color = "";
      probe.style.color = raw;
      const resolved = getComputedStyle(probe).color;
      if (resolved) tokenGreens.add(resolved);
    }
    probe.remove();

    const parse = (value: string) =>
      [...value.matchAll(/rgba?\(([^)]+)\)/g)].map((match) => {
        const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
        return { raw: `rgb(${parts.slice(0, 3).join(", ")})`, r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
      });

    const isGreen = (value: string) =>
      parse(value).some(
        (c) =>
          c.a > 0.04 &&
          (tokenGreens.has(c.raw) || (c.g > c.r + 20 && c.g > c.b + 20)),
      );

    const label = (node: Element) =>
      `${node.tagName.toLowerCase()}${
        typeof node.className === "string" && node.className
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;

    const hits: { element: string; property: string; value: string }[] = [];
    const focusReservations: { element: string; value: string }[] = [];
    const viewportHeight = window.innerHeight;

    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom <= 0 || rect.top >= viewportHeight) continue;

      const checks: [string, string][] = [
        ["color", style.color],
        ["background-color", style.backgroundColor],
        ["background-image", style.backgroundImage],
        ["box-shadow", style.boxShadow],
        ["fill", style.fill],
        ["stroke", style.stroke],
      ];
      for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
        const width = style[`border${side}Width` as "borderTopWidth"];
        const borderStyle = style[`border${side}Style` as "borderTopStyle"];
        if (width === "0px" || borderStyle === "none") continue;
        checks.push([
          `border-${side.toLowerCase()}-color`,
          style[`border${side}Color` as "borderTopColor"],
        ]);
      }
      if (style.textDecorationLine !== "none") {
        checks.push(["text-decoration-color", style.textDecorationColor]);
      }
      for (const [property, value] of checks) {
        if (!value || value === "none") continue;
        if (isGreen(value)) hits.push({ element: label(node), property, value });
      }
      if (style.outlineStyle !== "none" && isGreen(style.outlineColor)) {
        focusReservations.push({ element: label(node), value: style.outlineColor });
      }
    }

    return { tokenGreens: [...tokenGreens], hits, focusReservations };
  });
}

async function measure(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-f9-theme"),
    docHeight: document.documentElement.scrollHeight,
    overflow: Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
    greenMarks: document.querySelectorAll(".f9-wk-ins").length,
    ruleWeights: [
      ...new Set(
        [...document.querySelectorAll(".f9-wk-page, .f9-wk-page *")]
          .flatMap((node) => {
            const style = getComputedStyle(node);
            return [
              style.borderTopWidth,
              style.borderRightWidth,
              style.borderBottomWidth,
              style.borderLeftWidth,
            ];
          })
          .filter((width) => width !== "0px"),
      ),
    ].sort(),
  }));
}

test.describe("BL-030 live proof", () => {
  test.skip(!ENABLED, "set BL030_CAPTURE=1 to write the phase evidence set");
  test.setTimeout(15 * 60 * 1000);

  test("captures both rebuilt surfaces, an untouched route, and the scroll sweep", async ({
    browser,
    baseURL,
  }) => {
    const base = baseURL!;
    mkdirSync(OUT_DIR, { recursive: true });
    const metrics: unknown[] = [];
    const sweep: unknown[] = [];
    const failures: string[] = [];

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        for (const viewport of VIEWPORTS) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 2,
          });
          await prepare(context, base, surface.user, theme);
          const page = await context.newPage();
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
          });
          page.on("pageerror", (error) => pageErrors.push(String(error)));

          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(400);
          // A surface with an anchor is measured from that anchor down: the
          // record is its own view, so its green and rule budgets are counted
          // against the viewport a customer actually reads it in.
          const anchor = "anchor" in surface ? (surface as { anchor: string }).anchor : null;
          if (anchor) {
            await page.locator(anchor).first().scrollIntoViewIfNeeded();
            await page.waitForTimeout(200);
          }
          const measured = await measure(page);
          const green = await auditGreen(page);
          const file = path.join(
            OUT_DIR,
            `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`,
          );
          await page.screenshot({ path: file, fullPage: true });

          metrics.push({
            surface: surface.name,
            url: surface.url,
            user: surface.user,
            viewport: viewport.name,
            theme,
            resolvedTheme: measured.theme,
            docHeight: measured.docHeight,
            horizontalOverflow: measured.overflow,
            greenMarks: measured.greenMarks,
            // Every painted green in the first viewport, counted the honest
            // way (see auditGreen). The budget is ONE.
            greenPainted: green.hits.length,
            greenPaintedDetail: green.hits,
            greenFocusReservations: green.focusReservations.length,
            ruleWeights: measured.ruleWeights,
            consoleErrors,
            pageErrors,
            screenshot: path.basename(file),
          });
          if (consoleErrors.length || pageErrors.length) {
            failures.push(`${surface.name} ${viewport.name} ${theme}: console/page errors`);
          }
          if (measured.overflow > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: horizontal overflow ${measured.overflow}`,
            );
          }
          // One green mark per viewport is program law, so the evidence set
          // refuses to be produced with more than one — on a rebuilt surface.
          const rebuilt = !surface.name.startsWith("collections-");
          if (rebuilt && green.hits.length > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${green.hits.length} painted greens — ` +
                green.hits.map((hit) => `${hit.element}{${hit.property}}`).join(", "),
            );
          }
          await context.close();
        }
      }
    }

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await prepare(context, base, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(120);
          const overflow = await page.evaluate(() =>
            Math.max(
              0,
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
          );
          sweep.push({ surface: surface.name, theme, width, horizontalOverflow: overflow });
          if (overflow > 1) {
            failures.push(`sweep ${surface.name} ${theme} @${width}: overflow ${overflow}`);
          }
        }
        await context.close();
      }
    }

    writeFileSync(
      path.join(OUT_DIR, `${PREFIX}-metrics.json`),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), metrics, sweep }, null, 2)}\n`,
    );

    expect(failures, "zero console errors and zero horizontal scroll 320-2560").toEqual([]);
  });
});
