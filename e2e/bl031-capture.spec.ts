import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-031 live proof — /search in the landing language.
 *
 * Same harness contract as `bl030-capture.spec.ts`, extended to this surface
 * and to two probes that BL-030 did not need:
 *
 *  - `capsMono`: every element in the first viewport whose COMPUTED type is
 *    uppercase and set in the mono face. The boringness budget allows three
 *    per page and the old search surface painted eight. A source test can
 *    count `className="f9-wk-kick"`; only this can count what actually
 *    renders, which is BL-030 §12's lesson applied to a different budget.
 *  - `boxes`: elements inside the page that draw a perimeter border AND sit
 *    on a ground different from the page's. v4's whole correction was "every
 *    boxed thing went"; this counts the boxes rather than trusting the diff.
 *
 * Opt in with `BL031_CAPTURE=1` (optionally `BL031_OUT=<dir>`). It writes the
 * evidence set and REFUSES to write a passing one if a rebuilt surface paints
 * more than one green, spends more than three caps-mono surfaces, draws a
 * second rule weight, logs a console error, or scrolls horizontally anywhere
 * between 320 and 2560.
 */
const ENABLED = process.env.BL031_CAPTURE === "1";
const OUT_DIR =
  process.env.BL031_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl031";
const PREFIX = process.env.BL031_PREFIX ?? "after";

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
  { name: "search-idle", url: "/search", user: "e2e-starter" },
  { name: "search-idle-public", url: "/search", user: null },
  {
    name: "search-results",
    url: "/search?website=nykaa.com",
    user: "e2e-starter",
  },
  {
    // Signed-out results are captured ONCE. The anonymous live-search rate
    // limit is real product behaviour (per-IP, `enforcePublicSearchRateLimit`)
    // and six identical hits from one address trip it — a capture harness must
    // not ask the product to stop protecting itself in order to be
    // photographed.
    name: "search-results-public",
    url: "/search?website=nykaa.com",
    user: null,
    once: true,
  },
  {
    name: "search-selected",
    url: "/search?website=nykaa.com&selected=e2e-nykaa-live-1",
    user: "e2e-starter",
  },
  {
    name: "search-empty",
    url: "/search?website=fresh-empty.example",
    user: "e2e-starter",
  },
  {
    name: "search-degraded",
    url: "/search?website=stale.example",
    user: "e2e-starter",
  },
  {
    name: "search-invalid",
    url: "/search?website=not-a-domain",
    user: "e2e-starter",
  },
  {
    name: "search-free",
    url: "/search?website=nykaa.com&selected=e2e-nykaa-live-1",
    user: "e2e-free",
  },
  // Coexistence: an untouched route rendered in the same shell, so the claim
  // that unrebuilt surfaces keep working is photographed rather than asserted.
  { name: "collections-untouched", url: "/app/collections", user: "e2e-agency" },
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
        "x-0509-e2e-search-rollout": "v2",
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
 * channel beats both others by more than 20 (which is what caught the two
 * hardcoded search greens, `#65d5bb` and `#0a7b62`, that no class-scoped probe
 * would ever have seen), walk every visible element intersecting the first
 * viewport, and read the properties that are actually painted.
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
        const parts = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
        return {
          raw: `rgb(${parts.slice(0, 3).join(", ")})`,
          r: parts[0],
          g: parts[1],
          b: parts[2],
          a: parts[3] ?? 1,
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
        if (painted === 4 && (ownGround || style.boxShadow !== "none")) {
          // A form control IS a frame by design (DNA §2: inputs are frames,
          // not pills), so it is counted separately rather than held against
          // the "every boxed thing went" budget.
          (isFormControl ? frames : boxes).push(label(node));
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
    // amendment forbids "search needs its instrument" as a blanket defence —
    // this is what makes the per-element defence checkable.
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

test.describe("BL-031 live proof", () => {
  test.skip(!ENABLED, "set BL031_CAPTURE=1 to write the phase evidence set");
  test.setTimeout(20 * 60 * 1000);

  test("captures every /search state, an untouched route, and the scroll sweep", async ({
    browser,
    baseURL,
  }) => {
    const base = baseURL!;
    mkdirSync(OUT_DIR, { recursive: true });
    const metrics: unknown[] = [];
    const sweep: unknown[] = [];
    const failures: string[] = [];

    for (const surface of SURFACES) {
      const once = "once" in surface && (surface as { once: boolean }).once;
      for (const theme of once ? (["light"] as const) : THEMES) {
        for (const viewport of once ? [VIEWPORTS[1]] : VIEWPORTS) {
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
          const measured = await measure(page);
          const paint = await auditPaint(page);
          const file = path.join(
            OUT_DIR,
            `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`,
          );
          await page.screenshot({ path: file, fullPage: true });

          const rebuilt = surface.name.startsWith("search-");
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
          if (!rebuilt) {
            await context.close();
            continue;
          }
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
          await context.close();
        }
      }
    }

    for (const surface of SURFACES) {
      if ("once" in surface && (surface as { once: boolean }).once) continue;
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

    expect(
      failures,
      "one green, three caps-mono, one filled button PER VIEWPORT, one rule weight, 44px targets, zero console errors, zero horizontal scroll 320-2560",
    ).toEqual([]);
  });
});
