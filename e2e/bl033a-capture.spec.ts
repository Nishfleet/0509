import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-033a live proof — /app/collections in the landing language.
 *
 * The harness captures every reachable fixture state, including plan-locked,
 * first-run, filtered-empty, selected evidence, and each disclosure. It
 * refuses a passing evidence set if the surface paints more than one green,
 * spends more than three caps-mono labels, draws a second rule weight or a
 * shadow box, places two filled actions in one viewport, exposes a target
 * below 44px, logs a console error, or scrolls horizontally from 320–2560.
 */
const ENABLED = process.env.BL033A_CAPTURE === "1";
const OUT_DIR =
  process.env.BL033A_OUT ?? path.join(process.cwd(), ".artifacts", "bl033a-capture");
const PREFIX = process.env.BL033A_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;

/**
 * Every state a customer can actually reach on this route, including the
 * dishonest-looking ones. A rebuild that only photographs the happy result is
 * the reason the old empty and degraded states stayed slop for a year.
 */
const SURFACES = [
  {
    name: "collections-populated",
    url: "/app/collections",
    user: "e2e-starter",
  },
  {
    name: "collections-filed",
    url: "/app/collections?collection=e2e-collection-starter-1&item=e2e-collection-item-external",
    user: "e2e-starter",
  },
  {
    name: "collections-sample",
    url: "/app/collections?collection=e2e-collection-starter-1&item=e2e-collection-item-demo",
    user: "e2e-starter",
  },
  {
    name: "collections-stale-selection",
    url: "/app/collections?collection=e2e-collection-deleted",
    user: "e2e-starter",
  },
  {
    name: "collections-item-editor",
    url: "/app/collections",
    user: "e2e-starter",
    open: ".f9-library-item-editor > summary",
  },
  {
    name: "collections-external-form",
    url: "/app/collections",
    user: "e2e-starter",
    open: ".f9-library-external > summary",
  },
  {
    name: "collections-new-form",
    url: "/app/collections?collection=e2e-collection-starter-1&panel=new#new-collection",
    user: "e2e-starter",
  },
  {
    name: "collections-filtered-empty",
    url: "/app/collections?collection=e2e-collection-starter-1&advertiser=No+match",
    user: "e2e-starter",
  },
  {
    name: "collections-locked",
    url: "/app/collections",
    user: "e2e-free",
  },
  {
    name: "collections-first-run-scout",
    url: "/app/collections",
    user: "e2e-scout",
  },
  {
    name: "collections-first-run-agency",
    url: "/app/collections",
    user: "e2e-agency",
  },
  {
    name: "briefs-untouched",
    url: "/app/digests",
    user: "e2e-agency",
  },
] as const;

const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560];

async function prepare(
  context: BrowserContext,
  baseURL: string,
  user: string | null,
  theme: string,
) {
  if (user) {
    await context.addCookies([
      { name: "f9_e2e_fixture", value: user, url: baseURL, sameSite: "Lax" },
    ]);
  }
  await context.route(`${baseURL}/**`, (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        "x-0509-e2e-test-mode": "1",
      },
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
 * `.f9-wk-ins` class. Method is BL-030's, unchanged and quoted there: resolve
 * the token greens through a probe element, ALSO flag any colour whose green
 * channel beats both others by more than 20 (which catches hardcoded accent
 * colours that no class-scoped probe can see), walk every visible element
 * intersecting the first viewport, and read the properties actually painted.
 *
 * `outline-color` is collected separately as `focusReservations`: a focus ring
 * is not painted until focus lands and a green one is sanctioned.
 */
async function auditPaint(page: Page) {
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
        const tokens = match[1].split(/[,/\s]+/).filter(Boolean);
        const channels = tokens.slice(0, 3).map((token) =>
          token.endsWith("%")
            ? Number.parseFloat(token) * 2.55
            : Number(token),
        );
        const alphaToken = tokens[3];
        const alpha = alphaToken?.endsWith("%")
          ? Number.parseFloat(alphaToken) / 100
          : Number(alphaToken);
        return {
          raw: `rgb(${channels.join(", ")})`,
          r: channels[0],
          g: channels[1],
          b: channels[2],
          a: Number.isFinite(alpha) ? alpha : 1,
        };
      });

    const isGreen = (value: string) =>
      parse(value).some(
        (c) => c.a > 0.04 && (tokenGreens.has(c.raw) || (c.g > c.r + 20 && c.g > c.b + 20)),
      );

    const label = (node: Element) =>
      `${node.tagName.toLowerCase()}${
        typeof node.className === "string" && node.className
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;

    const page = document.querySelector(".f9-wk-page");
    const pageGrounds = new Set<string>();
    if (page) {
      pageGrounds.add(getComputedStyle(page).backgroundColor);
      pageGrounds.add(getComputedStyle(document.body).backgroundColor);
    }
    pageGrounds.add("rgba(0, 0, 0, 0)");
    pageGrounds.add("transparent");

    const hits: { element: string; property: string; value: string }[] = [];
    const focusReservations: { element: string; value: string }[] = [];
    const capsMono: string[] = [];
    const boxes: string[] = [];
    const frames: string[] = [];
    const viewportHeight = window.innerHeight;

    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const inViewport = rect.bottom > 0 && rect.top < viewportHeight;
      const insidePage = Boolean(page && page.contains(node));

      if (inViewport && insidePage) {
        const isFormControl = ["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName);
        // Caps-mono is a *computed* fact: uppercase transform on a stack whose
        // first family is the mono face. Counting class names cannot see a
        // component that reaches for the mono face on its own.
        const family = style.fontFamily.toLowerCase();
        if (
          style.textTransform === "uppercase" &&
          (family.includes("mono") || family.includes("plex mono")) &&
          (node.textContent ?? "").trim().length > 0
        ) {
          capsMono.push(`${label(node)}: ${(node.textContent ?? "").trim().slice(0, 40)}`);
        }
        // A box: all four borders painted, or a perimeter border plus a ground
        // that is not the page's. This is what v4 deleted from every surface.
        const widths = [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ];
        const painted = widths.filter((width) => width !== "0px").length;
        const ownGround = !pageGrounds.has(style.backgroundColor);
        const shadowed = style.boxShadow !== "none";
        if (shadowed || (painted === 4 && ownGround)) {
          // A form control IS a frame by design (DNA §2: inputs are frames,
          // not pills), so it is counted separately rather than held against
          // the "every boxed thing went" budget. The one sanctioned filled
          // Rank-1 command is audited below and is not a card/specimen box.
          if (isFormControl) {
            frames.push(label(node));
          } else if (!node.classList.contains("f9-wk-btn")) {
            boxes.push(label(node));
          }
        }
      }

      if (!inViewport) continue;

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

    return {
      tokenGreens: [...tokenGreens],
      hits,
      focusReservations,
      capsMono,
      boxes,
      frames,
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
    // The page's filled buttons. ROUND 2: the budget is one per VIEWPORT, not
    // one per document — the landing, this language's reference
    // implementation, draws two ink fills ~6,000px apart and they never share
    // a screen. `filledButtons` stays as the document total (reported, not
    // budgeted); `filledInAnyViewport` is the law, measured by sliding a
    // viewport-height window down the page and taking the worst window.
    filledButtons: document.querySelectorAll(".f9-wk-page .f9-wk-btn").length,
    filledInAnyViewport: (() => {
      const vh = window.innerHeight;
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
        boxes.filter((box) => box.bottom > start && box.top < start + vh).length;
      // Every window that could possibly be worst starts either at a button's
      // top or ends at a button's bottom.
      return Math.max(
        ...boxes.flatMap((box) => [count(box.top), count(box.bottom - vh)]),
      );
    })(),
    rows: document.querySelectorAll(".f9-wk-page .f9-wk-row").length,
    // The Mobbin-calibrated number the concept notes argue from: where the
    // first record a customer can act on begins, as a share of the viewport.
    // C1-C3 measured 15.5-20.6% on Attio / incident.io / Linear.
    firstRowTop: (() => {
      const row = document.querySelector(".f9-wk-page .f9-wk-row");
      if (!row) return null;
      return Math.round(row.getBoundingClientRect().top + window.scrollY);
    })(),
    // ROUND 2: the per-element stack above the first record, so the intent
    // audit argues from measured heights rather than from a single total. The
    // amendment forbids "this surface needs its instrument" as a blanket
    // defence — this is what makes each retained element checkable.
    firstRowStack: (() => {
      const page = document.querySelector(".f9-wk-page");
      const row = page?.querySelector(".f9-wk-row");
      if (!page || !row) return null;
      const name = (node: Element) =>
        `${node.tagName.toLowerCase()}${
          typeof node.className === "string" && node.className
            ? `.${node.className.trim().split(/\s+/).join(".")}`
            : ""
        }`;
      const stack: { el: string; top: number; height: number }[] = [];
      let node: Element | null = row;
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
    // Every interactive target inside the page, measured. 44px is the floor.
    smallTargets: [
      ...document.querySelectorAll(
        ".f9-wk-page a, .f9-wk-page button, .f9-wk-page input, .f9-wk-page select, .f9-wk-page textarea",
      ),
    ]
      .filter((node) => {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (node.getAttribute("aria-hidden") === "true") return false;
        if (node.hasAttribute("disabled")) return false;
        // Inline prose links are exempt, exactly as the release helper exempts
        // them: a link inside a sentence cannot be 44px tall without breaking
        // the sentence.
        if (
          node.tagName === "A" &&
          style.display === "inline" &&
          node.closest("p, li, dd")
        ) {
          return false;
        }
        return rect.height < 44 - 0.5 || rect.width < 44 - 0.5;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
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

test.describe("BL-033a live proof", () => {
  test.skip(!ENABLED, "set BL033A_CAPTURE=1 to write the phase evidence set");
  test.setTimeout(20 * 60 * 1000);

  test("captures every collections state, an untouched route, and the scroll sweep", async ({
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
          try {
            await prepare(context, base, surface.user, theme);
            const page = await context.newPage();
            const consoleErrors: string[] = [];
            const pageErrors: string[] = [];
            page.on("console", (message) => {
              if (message.type() === "error") consoleErrors.push(message.text());
            });
            page.on("pageerror", (error) => pageErrors.push(String(error)));

            await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
            if ("open" in surface && surface.open) {
              await page.locator(surface.open).click();
            }
            if (surface.name === "collections-populated") {
              const capturedFact = page
                .locator(".f9-wk-detail dt")
                .filter({ hasText: /^Captured$/ });
              await expect(capturedFact).toHaveCount(1);
              await expect(
                capturedFact.locator("xpath=following-sibling::dd[1]//time"),
              ).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}T/);
            }
            await page.waitForTimeout(400);
            const measured = await measure(page);
            const paint = await auditPaint(page);
            const file = path.join(
              OUT_DIR,
              `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`,
            );
            await page.screenshot({ path: file, fullPage: true });

            const rebuilt = surface.name.startsWith("collections-");
            metrics.push({
              surface: surface.name,
              url: surface.url,
              user: surface.user,
              viewport: viewport.name,
              theme,
              resolvedTheme: measured.theme,
              docHeight: measured.docHeight,
              horizontalOverflow: measured.overflow,
              filledButtons: measured.filledButtons,
              filledInAnyViewport: measured.filledInAnyViewport,
              rows: measured.rows,
              firstRowTop: measured.firstRowTop,
              firstRowStack: measured.firstRowStack,
              greenPainted: paint.hits.length,
              greenPaintedDetail: paint.hits,
              greenFocusReservations: paint.focusReservations.length,
              capsMono: paint.capsMono.length,
              capsMonoDetail: paint.capsMono,
              boxes: paint.boxes.length,
              boxesDetail: paint.boxes,
              frames: paint.frames.length,
              smallTargets: measured.smallTargets,
              ruleWeights: measured.ruleWeights,
              consoleErrors,
              pageErrors,
              screenshot: path.basename(file),
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
            if (!rebuilt) continue;

            // One green mark per viewport is program law, so the evidence set
            // refuses to be produced in breach.
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
            if (paint.boxes.length > 0) {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: boxed surfaces — ` +
                  paint.boxes.join(", "),
              );
            }
            if (measured.filledInAnyViewport > 1) {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: ${measured.filledInAnyViewport} filled buttons share one viewport ` +
                  `(${measured.filledButtons} on the document)`,
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
          } finally {
            await context.close();
          }
        }
      }
    }

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        try {
          await prepare(context, base, surface.user, theme);
          const page = await context.newPage();
          for (const width of SWEEP_WIDTHS) {
            await page.setViewportSize({ width, height: 900 });
            await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
            if ("open" in surface && surface.open) {
              await page.locator(surface.open).click();
            }
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
        } finally {
          await context.close();
        }
      }
    }

    writeFileSync(
      path.join(OUT_DIR, `${PREFIX}-metrics.json`),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), metrics, sweep }, null, 2)}\n`,
    );

    expect(
      failures,
      "one green, three caps-mono, zero shadow boxes, one filled button PER VIEWPORT, one rule weight, 44px targets, zero console errors, zero horizontal scroll 320-2560",
    ).toEqual([]);
  });
});
