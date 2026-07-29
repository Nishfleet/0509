import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-040 live proof — Source access and Developer access.
 *
 * Opt in with `BL040_CAPTURE=1` and optionally set `BL040_OUT`. The harness
 * captures both themes at the three program widths, records the exact stack
 * above the first ruled row, and sweeps 320–2560. It fails closed on the v4
 * budgets: at most one painted green per viewport, at most three caps-mono
 * surfaces, one filled button in any viewport-height window, 1px rules only,
 * 44px targets, no shadow cards, no console errors, and no horizontal scroll.
 */
const ENABLED = process.env.BL040_CAPTURE === "1";
const OUT_DIR =
  process.env.BL040_OUT ?? path.join(process.cwd(), "bl040-artifacts");
const PREFIX = process.env.BL040_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
const SWEEP_WIDTHS = [
  320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560,
];

const SURFACES = [
  {
    name: "source-owner",
    url: "/app/source-access",
    user: "e2e-starter",
  },
  {
    name: "source-member",
    url: "/app/source-access",
    user: "e2e-active-member",
  },
  {
    name: "developer-agency",
    url: "/app/developer-access",
    user: "e2e-agency",
  },
  {
    name: "developer-agency-confirm",
    url: "/app/developer-access",
    user: "e2e-agency",
    arm: "Revoke",
  },
  {
    name: "developer-starter-lock",
    url: "/app/developer-access",
    user: "e2e-starter",
  },
  {
    name: "developer-member",
    url: "/app/developer-access",
    user: "e2e-active-member",
  },
] as const;

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
      // The theme boot script falls back to light if storage is unavailable.
    }
  }, theme);
}

async function prepareSurface(
  page: Page,
  surface: (typeof SURFACES)[number],
) {
  if ("arm" in surface) {
    await page.getByRole("button", { name: surface.arm, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Confirm — revoke key?", exact: true }),
    ).toBeVisible();
  }
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
        const parts = match[1]
          .split(/[,/\s]+/)
          .filter(Boolean)
          .map(Number);
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

    const page = document.querySelector(".f9-wk-page");
    const hits: { element: string; property: string; value: string }[] = [];
    const capsMono: string[] = [];
    const shadows: string[] = [];
    const viewportHeight = window.innerHeight;

    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const inViewport = rect.bottom > 0 && rect.top < viewportHeight;
      const insidePage = Boolean(page?.contains(node));

      if (inViewport && insidePage) {
        const family = style.fontFamily.toLowerCase();
        if (
          style.textTransform === "uppercase" &&
          (family.includes("mono") || family.includes("plex mono")) &&
          (node.textContent ?? "").trim()
        ) {
          capsMono.push(
            `${label(node)}: ${(node.textContent ?? "").trim().slice(0, 48)}`,
          );
        }
        if (style.boxShadow !== "none") {
          shadows.push(`${label(node)}: ${style.boxShadow}`);
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
        if (value && value !== "none" && isGreen(value)) {
          hits.push({ element: label(node), property, value });
        }
      }
    }

    return { hits, capsMono, shadows };
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".f9-wk-page");
    const firstRow = root?.querySelector("[data-bl040-first-row]");
    const name = (node: Element) =>
      `${node.tagName.toLowerCase()}${
        typeof node.className === "string" && node.className
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;
    const firstRowStack: { el: string; top: number; height: number }[] = [];
    let stackNode: Element | null = firstRow ?? null;
    while (stackNode && stackNode !== root) {
      const parent: Element | null = stackNode.parentElement;
      if (!parent) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === stackNode) break;
        const rect = sibling.getBoundingClientRect();
        if (rect.height === 0) continue;
        firstRowStack.push({
          el: name(sibling),
          top: Math.round(rect.top + window.scrollY),
          height: Math.round(rect.height),
        });
      }
      stackNode = parent;
    }

    const filled = [...document.querySelectorAll(".f9-wk-page .f9-wk-btn")]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
        };
      })
      .filter((box) => box.bottom > box.top);
    const filledInAnyViewport = (() => {
      if (filled.length === 0) return 0;
      const viewportHeight = window.innerHeight;
      const count = (start: number) =>
        filled.filter(
          (box) =>
            box.bottom > start && box.top < start + viewportHeight,
        ).length;
      return Math.max(
        ...filled.flatMap((box) => [
          count(box.top),
          count(box.bottom - viewportHeight),
        ]),
      );
    })();

    const smallTargets = [
      ...document.querySelectorAll(
        ".f9-wk-page a, .f9-wk-page button, .f9-wk-page input, .f9-wk-page select, .f9-wk-page textarea",
      ),
    ]
      .filter((node) => {
        const style = getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden") {
          return false;
        }
        if (node.hasAttribute("disabled")) return false;
        if (
          node.tagName === "A" &&
          style.display === "inline" &&
          node.closest("p, li, dd")
        ) {
          return false;
        }
        const input = node as HTMLInputElement;
        const hitTarget =
          node.tagName === "INPUT" &&
          (input.type === "checkbox" || input.type === "radio")
            ? node.closest("label") ?? node
            : node;
        const rect = hitTarget.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.height < 43.5 || rect.width < 43.5;
      })
      .map((node) => {
        const input = node as HTMLInputElement;
        const hitTarget =
          node.tagName === "INPUT" &&
          (input.type === "checkbox" || input.type === "radio")
            ? node.closest("label") ?? node
            : node;
        const rect = hitTarget.getBoundingClientRect();
        return `${name(node)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
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
                (side) =>
                  style[`border${side}Width` as "borderTopWidth"],
              );
          })
          .filter((width) => width !== "0px"),
      ),
    ].sort();

    return {
      resolvedTheme:
        document.documentElement.getAttribute("data-f9-theme") ?? "light",
      docHeight: document.documentElement.scrollHeight,
      horizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      firstRowTop: firstRow
        ? Math.round(firstRow.getBoundingClientRect().top + window.scrollY)
        : null,
      firstRowStack: firstRowStack.sort((a, b) => a.top - b.top),
      filledButtons: filled.length,
      filledInAnyViewport,
      smallTargets,
      ruleWeights,
    };
  });
}

test.describe("BL-040 live proof", () => {
  test.skip(!ENABLED, "set BL040_CAPTURE=1 to write the phase evidence set");
  test.setTimeout(20 * 60 * 1000);

  test("captures all access states and sweeps 320–2560", async ({
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

          await page.goto(`${base}${surface.url}`, {
            waitUntil: "networkidle",
          });
          await prepareSurface(page, surface);
          await page.waitForTimeout(180);

          const measured = await measure(page);
          const paint = await auditPaint(page);
          const screenshot = `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`;
          await page.screenshot({
            path: path.join(OUT_DIR, screenshot),
            fullPage: true,
          });

          metrics.push({
            surface: surface.name,
            url: surface.url,
            user: surface.user,
            viewport: viewport.name,
            theme,
            ...measured,
            paintedGreens: paint.hits,
            capsMono: paint.capsMono,
            shadows: paint.shadows,
            consoleErrors,
            pageErrors,
            screenshot,
          });

          if (consoleErrors.length || pageErrors.length) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: console/page errors`,
            );
          }
          if (measured.horizontalOverflow > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: overflow ${measured.horizontalOverflow}`,
            );
          }
          if (paint.hits.length > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${paint.hits.length} painted greens`,
            );
          }
          if (paint.capsMono.length > 3) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${paint.capsMono.length} caps-mono surfaces`,
            );
          }
          if (paint.shadows.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: shadows ${paint.shadows.join(", ")}`,
            );
          }
          if (measured.filledInAnyViewport > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${measured.filledInAnyViewport} filled buttons share a viewport`,
            );
          }
          if (measured.smallTargets.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: targets under 44px ${measured.smallTargets.join(", ")}`,
            );
          }
          if (
            measured.ruleWeights.length > 0 &&
            measured.ruleWeights.join(",") !== "1px"
          ) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: rule weights ${measured.ruleWeights.join(", ")}`,
            );
          }
          await context.close();
        }
      }
    }

    for (const surface of SURFACES) {
      if ("arm" in surface) continue;
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        });
        await prepare(context, base, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${surface.url}`, {
            waitUntil: "networkidle",
          });
          const horizontalOverflow = await page.evaluate(() =>
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
            horizontalOverflow,
          });
          if (horizontalOverflow > 1) {
            failures.push(
              `sweep ${surface.name} ${theme} @${width}: overflow ${horizontalOverflow}`,
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
      "BL-040: ≤1 green, ≤3 caps-mono, ≤1 filled button per viewport, 1px rules, 44px targets, no shadows/errors/overflow",
    ).toEqual([]);
  });
});
