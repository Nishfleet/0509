import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-034 live proof — /app/presence in the landing language.
 *
 * Opt in with BL034_CAPTURE=1. The harness covers every plan-shaped index
 * state, both themes, the required capture widths, and overflow from 320 to
 * 2560. It refuses to pass when computed paint breaks the boringness budget.
 */
const ENABLED = process.env.BL034_CAPTURE === "1";
const OUT_DIR =
  process.env.BL034_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl034";
const PREFIX = process.env.BL034_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
const SURFACES = [
  { name: "presence-free-locked", user: "e2e-free" },
  { name: "presence-scout-empty", user: "e2e-scout" },
  { name: "presence-starter-populated", user: "e2e-starter" },
  { name: "presence-agency-empty", user: "e2e-agency" },
] as const;
const SWEEP_WIDTHS = [
  320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560,
];

async function prepare(
  context: BrowserContext,
  baseURL: string,
  user: string,
  theme: string,
) {
  await context.addCookies([
    {
      name: "f9_e2e_fixture",
      value: user,
      url: baseURL,
      sameSite: "Lax",
    },
  ]);
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
      // Storage-disabled browsers fall back to the product's light default.
    }
  }, theme);
}

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
        (colour) =>
          colour.a > 0.04 &&
          (tokenGreens.has(colour.raw) ||
            (colour.g > colour.r + 20 && colour.g > colour.b + 20)),
      );
    const label = (node: Element) =>
      `${node.tagName.toLowerCase()}${
        typeof node.className === "string" && node.className
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;

    const page = document.querySelector(".f9-presence-page");
    const pageGrounds = new Set([
      page ? getComputedStyle(page).backgroundColor : "",
      getComputedStyle(document.body).backgroundColor,
      "rgba(0, 0, 0, 0)",
      "transparent",
    ]);
    const hits: { element: string; property: string; value: string }[] = [];
    const focusReservations: { element: string; value: string }[] = [];
    const capsMono: string[] = [];
    const boxes: string[] = [];
    const frames: string[] = [];

    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const documentTop = rect.top + window.scrollY;
      const inDocument =
        rect.bottom + window.scrollY > 0 &&
        documentTop < document.documentElement.scrollHeight;
      const insidePage = Boolean(page?.contains(node));

      if (inDocument && insidePage) {
        const family = style.fontFamily.toLowerCase();
        if (
          style.textTransform === "uppercase" &&
          (family.includes("mono") || family.includes("plex mono")) &&
          (node.textContent ?? "").trim().length > 0
        ) {
          capsMono.push(`${label(node)}: ${(node.textContent ?? "").trim().slice(0, 40)}`);
        }

        const widths = [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ];
        const painted = widths.filter((width) => width !== "0px").length;
        const isFormControl = ["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName);
        if (
          painted === 4 &&
          (!pageGrounds.has(style.backgroundColor) || style.boxShadow !== "none")
        ) {
          (isFormControl ? frames : boxes).push(label(node));
        }
      }
      if (!inDocument) continue;

      const checks: [string, string][] = [
        ["color", style.color],
        ["background-color", style.backgroundColor],
        ["background-image", style.backgroundImage],
        ["box-shadow", style.boxShadow],
        ["fill", style.fill],
        ["stroke", style.stroke],
      ];
      for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
        if (
          style[`border${side}Width` as "borderTopWidth"] === "0px" ||
          style[`border${side}Style` as "borderTopStyle"] === "none"
        ) {
          continue;
        }
        checks.push([
          `border-${side.toLowerCase()}-color`,
          style[`border${side}Color` as "borderTopColor"],
        ]);
      }
      if (style.textDecorationLine !== "none") {
        checks.push(["text-decoration-color", style.textDecorationColor]);
      }
      for (const [property, value] of checks) {
        if (value && value !== "none" && isGreen(value)) {
          hits.push({ element: label(node), property, value });
        }
      }
      if (style.outlineStyle !== "none" && isGreen(style.outlineColor)) {
        focusReservations.push({ element: label(node), value: style.outlineColor });
      }
    }

    return { hits, focusReservations, capsMono, boxes, frames };
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll(".f9-presence-page .f9-wk-btn")]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
        };
      })
      .filter((box) => box.bottom > box.top);
    const viewportHeight = window.innerHeight;
    const countInWindow = (start: number) =>
      buttons.filter(
        (box) => box.bottom > start && box.top < start + viewportHeight,
      ).length;
    const filledInAnyViewport =
      buttons.length === 0
        ? 0
        : Math.max(
            ...buttons.flatMap((box) => [
              countInWindow(box.top),
              countInWindow(box.bottom - viewportHeight),
            ]),
          );
    const firstRow = document.querySelector(
      ".f9-presence-page [data-bl034-first-row]",
    );
    const firstRowStack = (() => {
      const page = document.querySelector(".f9-presence-page");
      if (!page || !firstRow) return null;
      const name = (node: Element) =>
        `${node.tagName.toLowerCase()}${
          typeof node.className === "string" && node.className
            ? `.${node.className.trim().split(/\s+/).join(".")}`
            : ""
        }`;
      const stack: { el: string; top: number; height: number }[] = [];
      let node: Element | null = firstRow;
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
      return stack.sort((left, right) => left.top - right.top);
    })();
    const smallTargets = [
      ...document.querySelectorAll(
        ".f9-presence-page a, .f9-presence-page button, .f9-presence-page input, .f9-presence-page select, .f9-presence-page textarea",
      ),
    ]
      .filter((node) => {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") return false;
        const rect = node.getBoundingClientRect();
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
        const rect = node.getBoundingClientRect();
        return `${node.tagName.toLowerCase()}.${
          typeof node.className === "string"
            ? node.className.trim().split(/\s+/).join(".")
            : ""
        } ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      });
    const ruleWeights = [
      ...new Set(
        [...document.querySelectorAll(".f9-presence-page, .f9-presence-page *")]
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
    ].sort();

    return {
      theme: document.documentElement.getAttribute("data-f9-theme"),
      docHeight: document.documentElement.scrollHeight,
      overflow: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      filledButtons: buttons.length,
      filledInAnyViewport,
      firstRowTop: firstRow
        ? Math.round(firstRow.getBoundingClientRect().top + window.scrollY)
        : null,
      firstRowStack,
      smallTargets,
      ruleWeights,
    };
  });
}

test.describe("BL-034 live proof", () => {
  test.skip(!ENABLED, "set BL034_CAPTURE=1 to write the BL-034 evidence set");
  test.setTimeout(20 * 60 * 1000);

  test("captures every plan state and the 320-2560 sweep", async ({
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
          let context: BrowserContext | null = null;
          const label = `${surface.name} ${viewport.name} ${theme}`;
          try {
            context = await browser.newContext({
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

            await page.goto(`${base}/app/presence`, { waitUntil: "networkidle" });
            await page.locator(".f9-presence-page").waitFor();
            const measured = await measure(page);
            const paint = await auditPaint(page);
            const expectedTheme = theme === "dark" ? "dark" : null;
            if (measured.theme !== expectedTheme) {
              failures.push(
                `${label}: resolved theme ${String(measured.theme)}, expected ${String(expectedTheme)}`,
              );
            }
            const file = path.join(
              OUT_DIR,
              `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`,
            );
            await page.screenshot({ path: file, fullPage: true });
            metrics.push({
              surface: surface.name,
              user: surface.user,
              viewport: viewport.name,
              theme,
              resolvedTheme: measured.theme,
              docHeight: measured.docHeight,
              horizontalOverflow: measured.overflow,
              filledButtons: measured.filledButtons,
              filledInAnyViewport: measured.filledInAnyViewport,
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
                `${label}: ${[
                  ...consoleErrors,
                  ...pageErrors,
                ].join(" | ")}`,
              );
            }
            if (measured.overflow > 1) {
              failures.push(`${label}: overflow ${measured.overflow}`);
            }
            if (paint.hits.length > 1) {
              failures.push(`${label}: ${paint.hits.length} painted greens`);
            }
            if (paint.capsMono.length > 3) {
              failures.push(`${label}: ${paint.capsMono.length} caps-mono surfaces`);
            }
            if (measured.filledInAnyViewport > 1) {
              failures.push(
                `${label}: ${measured.filledInAnyViewport} filled buttons share a viewport`,
              );
            }
            if (measured.smallTargets.length > 0) {
              failures.push(
                `${label}: targets under 44px — ${measured.smallTargets.join(", ")}`,
              );
            }
            if (
              measured.ruleWeights.length > 0 &&
              measured.ruleWeights.join(",") !== "1px"
            ) {
              failures.push(
                `${label}: rule weights ${measured.ruleWeights.join(", ")}`,
              );
            }
          } catch (error) {
            failures.push(
              `${label}: capture failed — ${error instanceof Error ? error.message : String(error)}`,
            );
          } finally {
            if (context) {
              await context.close().catch((error) => {
                failures.push(`${label}: context close failed — ${String(error)}`);
              });
            }
          }
        }
      }
    }

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        let context: BrowserContext | null = null;
        const label = `sweep ${surface.name} ${theme}`;
        try {
          context = await browser.newContext({
            viewport: { width: 1440, height: 900 },
          });
          await prepare(context, base, surface.user, theme);
          const page = await context.newPage();
          for (const width of SWEEP_WIDTHS) {
            try {
              await page.setViewportSize({ width, height: 900 });
              await page.goto(`${base}/app/presence`, {
                waitUntil: "domcontentloaded",
              });
              await page.locator(".f9-presence-page").waitFor();
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
                failures.push(`${label} @${width}: overflow ${overflow}`);
              }
            } catch (error) {
              failures.push(
                `${label} @${width}: failed — ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        } catch (error) {
          failures.push(
            `${label}: setup failed — ${error instanceof Error ? error.message : String(error)}`,
          );
        } finally {
          if (context) {
            await context.close().catch((error) => {
              failures.push(`${label}: context close failed — ${String(error)}`);
            });
          }
        }
      }
    }

    writeFileSync(
      path.join(OUT_DIR, `${PREFIX}-metrics.json`),
      `${JSON.stringify(
        { capturedAt: new Date().toISOString(), metrics, sweep },
        null,
        2,
      )}\n`,
    );

    expect(
      failures,
      "one green maximum, three caps-mono maximum, one filled button per viewport, one 1px rule, 44px targets, zero console errors, zero overflow",
    ).toEqual([]);
  });
});
