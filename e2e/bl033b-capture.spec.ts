import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-033b live proof — the reports shelf, in-app report, and quiet plan gate.
 *
 * Opt in with BL033B_CAPTURE=1. The harness follows BL-030/31: it measures
 * actual paint and geometry, captures both themes at three widths, and sweeps
 * horizontal overflow from 320 through 2560.
 */
const ENABLED = process.env.BL033B_CAPTURE === "1";
const OUT_DIR =
  process.env.BL033B_OUT ??
  path.resolve(process.cwd(), "../0509-audit-artifacts-bl033b");
const PREFIX = process.env.BL033B_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
const SURFACES = [
  { name: "reports-list", url: "/app/reports", user: "e2e-agency", rebuilt: true },
  { name: "reports-locked", url: "/app/reports", user: "e2e-starter", rebuilt: true },
  {
    name: "report-view",
    url: "/app/reports/watchlist:e2e-watchlist-agency-1",
    user: "e2e-agency",
    rebuilt: true,
  },
  {
    name: "report-view-quiet",
    url: "/app/reports/watchlist:e2e-watchlist-agency-quiet",
    user: "e2e-agency",
    rebuilt: true,
  },
  {
    name: "report-locked-deep",
    url: "/app/reports/watchlist:e2e-watchlist-starter-1",
    user: "e2e-starter",
    rebuilt: true,
  },
  {
    name: "collections-control",
    url: "/app/collections",
    user: "e2e-agency",
    rebuilt: false,
  },
] as const;
const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560];

async function prepare(
  context: BrowserContext,
  baseURL: string,
  user: string,
  theme: string,
) {
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
      /* The boot script falls back to light when storage is unavailable. */
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
        (color) =>
          color.a > 0.04 &&
          (tokenGreens.has(color.raw) ||
            (color.g > color.r + 20 && color.g > color.b + 20)),
      );
    const label = (node: Element) =>
      `${node.tagName.toLowerCase()}${
        typeof node.className === "string" && node.className
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;

    const surface = document.querySelector(".f9-wk-page");
    const pageGrounds = new Set([
      "rgba(0, 0, 0, 0)",
      "transparent",
      getComputedStyle(document.body).backgroundColor,
      ...(surface ? [getComputedStyle(surface).backgroundColor] : []),
    ]);
    const hits: {
      element: string;
      property: string;
      value: string;
      top: number;
      bottom: number;
    }[] = [];
    const capsMono: string[] = [];
    const boxes: string[] = [];

    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const insideSurface = Boolean(surface?.contains(node));
      if (!insideSurface) continue;

      const family = style.fontFamily.toLowerCase();
      if (
        style.textTransform === "uppercase" &&
        (family.includes("mono") || family.includes("plex mono")) &&
        (node.textContent ?? "").trim()
      ) {
        capsMono.push(`${label(node)}: ${(node.textContent ?? "").trim().slice(0, 48)}`);
      }

      const borderWidths = [
        style.borderTopWidth,
        style.borderRightWidth,
        style.borderBottomWidth,
        style.borderLeftWidth,
      ];
      const paintedSides = borderWidths.filter((width) => width !== "0px").length;
      if (
        paintedSides === 4 &&
        (!pageGrounds.has(style.backgroundColor) || style.boxShadow !== "none") &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(node.tagName)
      ) {
        boxes.push(label(node));
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
        if (!value || value === "none" || !isGreen(value)) continue;
        hits.push({
          element: label(node),
          property,
          value,
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
        });
      }
    }

    const viewportHeight = window.innerHeight;
    const count = (start: number) =>
      hits.filter((hit) => hit.bottom > start && hit.top < start + viewportHeight).length;
    const greenInAnyViewport =
      hits.length === 0
        ? 0
        : Math.max(
            ...hits.flatMap((hit) => [
              count(hit.top),
              count(hit.bottom - viewportHeight),
            ]),
          );

    return {
      tokenGreens: [...tokenGreens],
      hits,
      greenInAnyViewport,
      capsMono,
      boxes,
    };
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const elementName = (node: Element) =>
      `${node.tagName.toLowerCase()}${
        typeof node.className === "string" && node.className
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;
    const viewportMaximum = (selector: string) => {
      const viewportHeight = window.innerHeight;
      const rects = [...document.querySelectorAll(selector)]
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            top: rect.top + window.scrollY,
            bottom: rect.bottom + window.scrollY,
          };
        })
        .filter((rect) => rect.bottom > rect.top);
      if (rects.length === 0) return 0;
      const count = (start: number) =>
        rects.filter(
          (rect) => rect.bottom > start && rect.top < start + viewportHeight,
        ).length;
      return Math.max(
        ...rects.flatMap((rect) => [
          count(rect.top),
          count(rect.bottom - viewportHeight),
        ]),
      );
    };
    const firstRow = document.querySelector(".f9-wk-page .f9-wk-row");
    const firstRowStack = (() => {
      const surface = document.querySelector(".f9-wk-page");
      if (!surface || !firstRow) return null;
      const stack: { el: string; top: number; height: number }[] = [];
      let node: Element | null = firstRow;
      while (node && node !== surface) {
        const parent: Element | null = node.parentElement;
        if (!parent) break;
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node) break;
          const rect = sibling.getBoundingClientRect();
          if (rect.height > 0) {
            stack.push({
              el: elementName(sibling),
              top: Math.round(rect.top + window.scrollY),
              height: Math.round(rect.height),
            });
          }
        }
        node = parent;
      }
      return stack.sort((left, right) => left.top - right.top);
    })();

    const smallTargets = [
      ...document.querySelectorAll(
        ".f9-wk-page a, .f9-wk-page button, .f9-wk-page input, .f9-wk-page select, .f9-wk-page textarea, .f9-wk-page summary",
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
        if (
          node instanceof HTMLInputElement &&
          (node.type === "checkbox" || node.type === "radio")
        ) {
          const label = node.closest("label");
          if (label) {
            const labelRect = label.getBoundingClientRect();
            if (labelRect.width >= 43.5 && labelRect.height >= 43.5) {
              return false;
            }
          }
        }
        return rect.width < 43.5 || rect.height < 43.5;
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
        [...document.querySelectorAll(".f9-wk-page, .f9-wk-page *")]
          .flatMap((node) => {
            const style = getComputedStyle(node);
            return (["Top", "Right", "Bottom", "Left"] as const)
              .filter(
                (side) =>
                  style[`border${side}Style` as "borderTopStyle"] !== "none",
              )
              .map(
                (side) => style[`border${side}Width` as "borderTopWidth"],
              );
          })
          .filter((width) => width !== "0px"),
      ),
    ].sort();

    const dashedRules = [
      ...document.querySelectorAll(".f9-wk-page, .f9-wk-page *"),
    ].flatMap((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        rect.width === 0 ||
        rect.height === 0
      ) {
        return [];
      }
      return (["Top", "Right", "Bottom", "Left"] as const)
        .filter(
          (side) =>
            style[`border${side}Style` as "borderTopStyle"] === "dashed" &&
            style[`border${side}Width` as "borderTopWidth"] !== "0px",
        )
        .map((side) => `${elementName(node)} border-${side.toLowerCase()}`);
    });

    return {
      theme: document.documentElement.getAttribute("data-f9-theme"),
      docHeight: document.documentElement.scrollHeight,
      overflow: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      filledButtons: document.querySelectorAll(".f9-wk-page .f9-wk-btn").length,
      filledInAnyViewport: viewportMaximum(".f9-wk-page .f9-wk-btn"),
      firstRowTop: firstRow
        ? Math.round(firstRow.getBoundingClientRect().top + window.scrollY)
        : null,
      firstRowStack,
      rows: document.querySelectorAll(".f9-wk-page .f9-wk-row").length,
      smallTargets,
      ruleWeights,
      dashedRules,
    };
  });
}

test.describe("BL-033b live proof", () => {
  test.skip(!ENABLED, "set BL033B_CAPTURE=1 to write the reports evidence set");
  test.setTimeout(20 * 60 * 1000);

  test("captures every reports state and sweeps overflow", async ({
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
          await page.waitForTimeout(300);
          const measured = await measure(page);
          const paint = await auditPaint(page);
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
            filledButtons: measured.filledButtons,
            filledInAnyViewport: measured.filledInAnyViewport,
            rows: measured.rows,
            firstRowTop: measured.firstRowTop,
            firstRowStack: measured.firstRowStack,
            greenPainted: paint.hits.length,
            greenInAnyViewport: paint.greenInAnyViewport,
            greenPaintedDetail: paint.hits,
            capsMono: paint.capsMono.length,
            capsMonoDetail: paint.capsMono,
            boxes: paint.boxes.length,
            boxesDetail: paint.boxes,
            smallTargets: measured.smallTargets,
            ruleWeights: measured.ruleWeights,
            dashedRules: measured.dashedRules,
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
          if (measured.overflow > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: horizontal overflow ${measured.overflow}`,
            );
          }
          if (surface.rebuilt) {
            if (paint.greenInAnyViewport > 1) {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: ${paint.greenInAnyViewport} green paints share a viewport`,
              );
            }
            if (paint.capsMono.length > 3) {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: ${paint.capsMono.length} caps-mono surfaces — ${paint.capsMono.join(" | ")}`,
              );
            }
            if (measured.filledInAnyViewport > 1) {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: ${measured.filledInAnyViewport} filled actions share a viewport`,
              );
            }
            if (measured.smallTargets.length > 0) {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: targets under 44px — ${measured.smallTargets.join(", ")}`,
              );
            }
            if (measured.ruleWeights.join(",") !== "1px") {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: rule weights ${measured.ruleWeights.join(", ") || "none"}`,
              );
            }
            if (measured.dashedRules.length > 0) {
              failures.push(
                `${surface.name} ${viewport.name} ${theme}: dashed specimen rules — ${measured.dashedRules.join(", ")}`,
              );
            }
          }
          await context.close();
        }
      }
    }

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        });
        await prepare(context, base, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(100);
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
          if (overflow > 0) {
            failures.push(
              `sweep ${surface.name} ${theme} @${width}: overflow ${overflow}`,
            );
          }
        }
        await context.close();
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
      "one green and one filled action per viewport, at most three caps-mono surfaces, 1px rules, 44px targets, zero console errors, zero horizontal scroll 320-2560",
    ).toEqual([]);
  });
});
