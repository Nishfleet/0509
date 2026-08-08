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
const BL036_ENABLED = process.env.BL036_CAPTURE === "1";
const BL036_OUT_DIR =
  process.env.BL036_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl036";
const BL035_ENABLED = process.env.BL035_CAPTURE === "1";
const BL035_OUT_DIR =
  process.env.BL035_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl035";
const BL035_PREFIX = process.env.BL035_PREFIX ?? "after";

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
    // Artifact name retained for BL-030 comparison. BL-035 replaces the old
    // peek pane with the entity-owned detail surface at the same URL.
    name: "competitors-pane",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1",
    user: "e2e-starter",
  },
  // Compatibility proof: each retained tab still captures under the original
  // BL-030 artifact name, now anchored to BL-035's working tab bar.
  {
    name: "detail-changed",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1",
    user: "e2e-starter",
    anchor: ".f9-watchdetail-tabs",
  },
  {
    name: "detail-evidence",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence",
    user: "e2e-starter",
    anchor: ".f9-watchdetail-tabs",
  },
  {
    name: "detail-delivery",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=delivery",
    user: "e2e-starter",
    anchor: ".f9-watchdetail-tabs",
  },
  {
    name: "detail-setup",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=setup",
    user: "e2e-starter",
    anchor: ".f9-watchdetail-tabs",
  },
  { name: "collections-untouched", url: "/app/collections", user: "e2e-agency" },
] as const;
const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560];
const BL035_SURFACES = [
  {
    name: "changed-starter",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1",
    user: "e2e-starter",
  },
  {
    name: "evidence-starter",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=evidence",
    user: "e2e-starter",
  },
  {
    name: "creative-starter",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=creative",
    user: "e2e-starter",
  },
  {
    name: "delivery-starter",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=delivery",
    user: "e2e-starter",
  },
  {
    name: "setup-starter",
    url: "/app/watchlists?watchlist=e2e-watchlist-starter-1&tab=setup",
    user: "e2e-starter",
  },
  {
    name: "changed-agency-quiet",
    url: "/app/watchlists?watchlist=e2e-watchlist-agency-quiet",
    user: "e2e-agency",
  },
  {
    name: "changed-free-first-brief",
    url: "/app/watchlists?watchlist=e2e-watchlist-firstbrief",
    user: "e2e-free-firstbrief",
  },
] as const;

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
    const capsMono: string[] = [];
    const shadows: string[] = [];
    const viewportHeight = window.innerHeight;
    const page = document.querySelector(".f9-wk-page");

    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom <= 0 || rect.top >= viewportHeight) continue;
      if (page?.contains(node)) {
        const family = style.fontFamily.toLowerCase();
        if (
          style.textTransform === "uppercase" &&
          (family.includes("mono") || family.includes("plex mono")) &&
          (node.textContent ?? "").trim().length > 0
        ) {
          capsMono.push(`${label(node)}: ${(node.textContent ?? "").trim().slice(0, 40)}`);
        }
        if (style.boxShadow !== "none") shadows.push(`${label(node)}: ${style.boxShadow}`);
      }

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

    /**
     * Round 4: the announcement green, measured as a PAINTED node rather than
     * as a CSS string. Document-scoped on purpose — the plate that owns the
     * announcement may sit below the fold, and "the rule matched nothing" is
     * exactly the defect that shipped in round 3.
     */
    const plateMarks = [...document.querySelectorAll(".f9-evidence-diff-value mark")];
    const paintedPlateMarks = plateMarks.filter((node) =>
      isGreen(getComputedStyle(node).backgroundColor),
    );
    const markablePlates = document.querySelectorAll(
      ".f9-evidence-diff-plate.is-newest",
    ).length;

    return {
      tokenGreens: [...tokenGreens],
      hits,
      focusReservations,
      plateMarks: plateMarks.length,
      paintedPlateMarks: paintedPlateMarks.length,
      paintedPlateMarkValues: paintedPlateMarks.map((node) => node.textContent ?? ""),
      markablePlates,
      capsMono,
      shadows,
    };
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
    filledButtons: document.querySelectorAll(".f9-wk-page .f9-wk-btn").length,
    filledInAnyViewport: (() => {
      const viewportHeight = window.innerHeight;
      const boxes = [...document.querySelectorAll(".f9-wk-page .f9-wk-btn")]
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            top: rect.top + window.scrollY,
            bottom: rect.bottom + window.scrollY,
          };
        })
        .filter((box) => box.bottom > box.top);
      if (boxes.length === 0) return 0;
      const count = (start: number) =>
        boxes.filter(
          (box) => box.bottom > start && box.top < start + viewportHeight,
        ).length;
      return Math.max(
        ...boxes.flatMap((box) => [
          count(box.top),
          count(box.bottom - viewportHeight),
        ]),
      );
    })(),
    firstContentTop: (() => {
      const content = document.querySelector(".f9-watchdetail-main");
      if (!content) return null;
      return Math.round(content.getBoundingClientRect().top + window.scrollY);
    })(),
    firstRowStack: (() => {
      const page = document.querySelector(".f9-wk-page");
      const content = page?.querySelector(".f9-watchdetail-main");
      if (!page || !content) return null;
      const name = (node: Element) =>
        `${node.tagName.toLowerCase()}${
          typeof node.className === "string" && node.className
            ? `.${node.className.trim().split(/\s+/).join(".")}`
            : ""
        }`;
      const stack: { el: string; top: number; height: number }[] = [];
      let node: Element | null = content;
      while (node && node !== page) {
        const parent: Element | null = node.parentElement;
        if (!parent) break;
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node) break;
          const rect = sibling.getBoundingClientRect();
          if (rect.height === 0) continue;
          stack.push({
            el: name(sibling),
            top: Math.round(rect.top + window.scrollY),
            height: Math.round(rect.height),
          });
        }
        node = parent;
      }
      return stack.sort((a, b) => a.top - b.top);
    })(),
    smallTargets: [
      ...document.querySelectorAll(
        ".f9-wk-page a, .f9-wk-page button, .f9-wk-page input, .f9-wk-page select, .f9-wk-page textarea, .f9-wk-page summary",
      ),
    ]
      .filter((node) => {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const inputType =
          node instanceof HTMLInputElement ? node.type.toLowerCase() : "";
        const target =
          inputType === "checkbox" || inputType === "radio"
            ? node.closest("label") ?? node
            : node;
        const rect = target.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("disabled")) {
          return false;
        }
        if (
          node.tagName === "A" &&
          style.display === "inline" &&
          node.closest("p, li, dd")
        ) {
          return false;
        }
        return rect.height < 43.5 || rect.width < 43.5;
      })
      .map((node) => {
        const inputType =
          node instanceof HTMLInputElement ? node.type.toLowerCase() : "";
        const target =
          inputType === "checkbox" || inputType === "radio"
            ? node.closest("label") ?? node
            : node;
        const rect = target.getBoundingClientRect();
        return `${node.tagName.toLowerCase()}.${
          typeof node.className === "string"
            ? node.className.trim().split(/\s+/).join(".")
            : ""
        } ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      }),
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
          // Anchored compatibility surfaces measure from the working tab bar
          // down, where the customer reads the retained tab content.
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
            // Document-scoped announcement proof (round 4).
            plateMarks: green.plateMarks,
            paintedPlateMarks: green.paintedPlateMarks,
            paintedPlateMarkValues: green.paintedPlateMarkValues,
            markablePlates: green.markablePlates,
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
          /**
           * The record's announcement, asserted as paint. If the feed contains
           * an event that carries a before/now mark, EXACTLY ONE plate mark in
           * the document must resolve green — and if it does not, no plate
           * mark may. Round 3 advertised this fill while shipping a selector
           * that matched nothing; this is the assertion that would have caught
           * it, and it runs in both themes at all three widths.
           */
          if (surface.name.startsWith("detail-") || surface.name === "competitors-pane") {
            const expected = green.markablePlates > 0 ? 1 : 0;
            if (green.paintedPlateMarks !== expected) {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: ${green.paintedPlateMarks} painted plate marks, expected ${expected} ` +
                  `(${green.markablePlates} plate(s) carry is-newest, ${green.plateMarks} NOW token(s) in the feed)`,
              );
            }
          }

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

test.describe("BL-036 quiet Agency detail proof", () => {
  test.skip(!BL036_ENABLED, "set BL036_CAPTURE=1 to capture the quiet Agency state");

  test("captures the 1440 quiet detail in both themes without changing the paint law", async ({
    browser,
    baseURL,
  }) => {
    mkdirSync(BL036_OUT_DIR, { recursive: true });
    const metrics: unknown[] = [];
    const failures: string[] = [];

    for (const theme of THEMES) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
      });
      await prepare(context, baseURL!, "e2e-agency", theme);
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(String(error)));

      await page.goto(
        `${baseURL}/app/watchlists?watchlist=e2e-watchlist-agency-quiet`,
        { waitUntil: "networkidle" },
      );
      await expect(
        page.locator(".f9-watchdetail-detail").getByRole("link", {
          name: "Package for client",
        }),
      ).toBeVisible();

      const measured = await measure(page);
      const green = await auditGreen(page);
      const screenshot = `bl036-quiet-agency-detail-1440-${theme}.png`;
      await page.screenshot({
        path: path.join(BL036_OUT_DIR, screenshot),
        fullPage: true,
      });

      metrics.push({
        theme,
        resolvedTheme: measured.theme,
        viewport: "1440x900",
        horizontalOverflow: measured.overflow,
        greenPainted: green.hits.length,
        greenPaintedDetail: green.hits,
        paintedPlateMarks: green.paintedPlateMarks,
        markablePlates: green.markablePlates,
        ruleWeights: measured.ruleWeights,
        consoleErrors,
        pageErrors,
        screenshot,
      });
      if (measured.overflow > 1) {
        failures.push(`${theme}: horizontal overflow ${measured.overflow}`);
      }
      if (green.hits.length > 1) {
        failures.push(`${theme}: ${green.hits.length} painted greens`);
      }
      if (green.paintedPlateMarks !== 0 || green.markablePlates !== 0) {
        failures.push(
          `${theme}: quiet state painted ${green.paintedPlateMarks} change marks across ${green.markablePlates} markable plates`,
        );
      }
      if (consoleErrors.length || pageErrors.length) {
        failures.push(`${theme}: console/page errors`);
      }
      await context.close();
    }

    writeFileSync(
      path.join(BL036_OUT_DIR, "bl036-quiet-agency-detail-metrics.json"),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), metrics }, null, 2)}\n`,
    );
    expect(failures, "quiet Agency proof preserves the one-green paint law").toEqual([]);
  });
});

test.describe("BL-035 competitor detail live proof", () => {
  test.skip(!BL035_ENABLED, "set BL035_CAPTURE=1 to write the phase evidence set");
  test.setTimeout(25 * 60 * 1000);

  test("captures all five tabs, entitlement states, and the 320–2560 sweep", async ({
    browser,
    baseURL,
  }) => {
    const base = baseURL!;
    mkdirSync(BL035_OUT_DIR, { recursive: true });
    const metrics: unknown[] = [];
    const sweep: unknown[] = [];
    const failures: string[] = [];

    for (const surface of BL035_SURFACES) {
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
          await expect(page.locator(".f9-watchdetail-detail")).toBeVisible();
          await expect(page.locator(".f9-wk-board")).toHaveCount(0);
          await expect(
            page.getByRole("navigation", { name: "Competitor sections" }).getByRole("link"),
          ).toHaveCount(5);

          const measured = await measure(page);
          const paint = await auditGreen(page);
          const screenshot = `${BL035_PREFIX}-${surface.name}-${viewport.name}-${theme}.png`;
          await page.screenshot({
            path: path.join(BL035_OUT_DIR, screenshot),
            fullPage: true,
          });

          metrics.push({
            surface: surface.name,
            url: surface.url,
            user: surface.user,
            viewport: viewport.name,
            theme,
            resolvedTheme: measured.theme,
            docHeight: measured.docHeight,
            horizontalOverflow: measured.overflow,
            firstContentTop: measured.firstContentTop,
            firstRowStack: measured.firstRowStack,
            filledButtons: measured.filledButtons,
            filledInAnyViewport: measured.filledInAnyViewport,
            greenPainted: paint.hits.length,
            greenPaintedDetail: paint.hits,
            greenFocusReservations: paint.focusReservations.length,
            capsMono: paint.capsMono.length,
            capsMonoDetail: paint.capsMono,
            shadows: paint.shadows,
            smallTargets: measured.smallTargets,
            ruleWeights: measured.ruleWeights,
            consoleErrors,
            pageErrors,
            screenshot,
          });

          if (consoleErrors.length || pageErrors.length) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: console/page errors — ${[
                ...consoleErrors,
                ...pageErrors,
              ].join(" | ")}`,
            );
          }
          if (measured.overflow > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: horizontal overflow ${measured.overflow}`,
            );
          }
          if (paint.hits.length > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${paint.hits.length} painted greens — ` +
                paint.hits.map((hit) => `${hit.element}{${hit.property}}`).join(", "),
            );
          }
          if (paint.capsMono.length > 3) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${paint.capsMono.length} caps-mono surfaces — ` +
                paint.capsMono.join(" | "),
            );
          }
          if (paint.shadows.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: shadows — ${paint.shadows.join(", ")}`,
            );
          }
          if (measured.filledInAnyViewport > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${measured.filledInAnyViewport} filled actions share a viewport ` +
                `(${measured.filledButtons} in the document)`,
            );
          }
          if (measured.smallTargets.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: targets under 44px — ` +
                measured.smallTargets.join(", "),
            );
          }
          const weights = measured.ruleWeights.filter((width) => width !== "0px");
          if (weights.length > 0 && weights.join(",") !== "1px") {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: rule weights ${weights.join(", ")}`,
            );
          }
          if (
            measured.firstContentTop !== null &&
            measured.firstContentTop > viewport.height * 0.65
          ) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: first content starts at ${measured.firstContentTop}px`,
            );
          }
          await context.close();
        }
      }
    }

    for (const surface of BL035_SURFACES) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        });
        await prepare(context, base, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(120);
          const overflow = await page.evaluate(() =>
            Math.max(
              0,
              document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
            ),
          );
          sweep.push({
            surface: surface.name,
            theme,
            width,
            horizontalOverflow: overflow,
          });
          if (overflow > 1) {
            failures.push(
              `sweep ${surface.name} ${theme} @${width}: overflow ${overflow}`,
            );
          }
        }
        await context.close();
      }
    }

    writeFileSync(
      path.join(BL035_OUT_DIR, `${BL035_PREFIX}-metrics.json`),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), metrics, sweep }, null, 2)}\n`,
    );

    expect(
      failures,
      "BL-035: ≤1 green, ≤3 caps-mono, ≤1 filled action per viewport, 1px rules, 44px targets, first-content discipline, zero shadows/errors/overflow",
    ).toEqual([]);
  });
});
