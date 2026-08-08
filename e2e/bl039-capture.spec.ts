import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-039 live proof — /app/notifications in the landing language.
 *
 * Opt in with `BL039_CAPTURE=1` and optionally `BL039_OUT=<dir>`. The harness
 * photographs the GA surface by plan and refuses to pass if the rebuilt page
 * paints more than one green, spends more than three caps-mono surfaces, puts
 * two filled actions in one viewport, draws a non-1px rule, exposes a target
 * under 44px, logs a browser error, or scrolls horizontally at 320–2560.
 */
const ENABLED = process.env.BL039_CAPTURE === "1";
const OUT_DIR =
  process.env.BL039_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl039";
const PREFIX = process.env.BL039_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
const SURFACES = [
  { name: "notifications-free", url: "/app/notifications", user: "e2e-free" },
  { name: "notifications-scout", url: "/app/notifications", user: "e2e-scout" },
  { name: "notifications-starter", url: "/app/notifications", user: "e2e-starter" },
  { name: "notifications-agency", url: "/app/notifications", user: "e2e-agency" },
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

    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const canvasContext = canvas.getContext("2d", { willReadFrequently: true });
    const parse = (value: string) => {
      if (!canvasContext) return [];
      const candidates =
        value.match(
          /(?:rgba?|oklch|lab|lch|color)\([^)]*\)|#[0-9a-f]{3,8}\b/gi,
        ) ?? [];
      return candidates.flatMap((candidate) => {
        canvasContext.clearRect(0, 0, 1, 1);
        canvasContext.fillStyle = "rgba(0, 0, 0, 0)";
        canvasContext.fillStyle = candidate;
        canvasContext.fillRect(0, 0, 1, 1);
        const [r, g, b, alpha] = canvasContext.getImageData(0, 0, 1, 1).data;
        if (alpha === 0) return [];
        return [
          {
            raw: `rgb(${r}, ${g}, ${b})`,
            r,
            g,
            b,
            a: alpha / 255,
          },
        ];
      });
    };
    const normalizedTokenGreens = new Set(
      [...tokenGreens].flatMap((value) => parse(value).map((color) => color.raw)),
    );
    const isGreen = (value: string) =>
      parse(value).some(
        (color) =>
          color.a > 0.04 &&
          (normalizedTokenGreens.has(color.raw) ||
            (color.g > color.r + 20 && color.g > color.b + 20)),
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
    const viewportHeight = window.innerHeight;
    const page = document.querySelector(".f9-notif-page");

    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const inViewport = rect.bottom > 0 && rect.top < viewportHeight;

      if (
        inViewport &&
        page?.contains(node) &&
        style.textTransform === "uppercase" &&
        (style.fontFamily.toLowerCase().includes("mono") ||
          style.fontFamily.toLowerCase().includes("plex mono")) &&
        (node.textContent ?? "").trim()
      ) {
        capsMono.push(`${label(node)}: ${(node.textContent ?? "").trim().slice(0, 40)}`);
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
      if (style.outlineStyle !== "none" && isGreen(style.outlineColor)) {
        focusReservations.push({ element: label(node), value: style.outlineColor });
      }
    }

    return { hits, focusReservations, capsMono };
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const filled = [...document.querySelectorAll(".f9-notif-page .f9-wk-btn")]
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
      filled.filter(
        (box) => box.bottom > start && box.top < start + viewportHeight,
      ).length;
    const filledInAnyViewport =
      filled.length === 0
        ? 0
        : Math.max(
            ...filled.flatMap((box) => [
              countInWindow(box.top),
              countInWindow(box.bottom - viewportHeight),
            ]),
          );
    const page = document.querySelector(".f9-notif-page");
    const firstRow = page?.querySelector(".f9-notif-definition-row");
    const firstRowStack: { el: string; top: number; height: number }[] = [];
    if (page && firstRow) {
      let node: Element | null = firstRow;
      while (node && node !== page) {
        const parent: Element | null = node.parentElement;
        if (!parent) break;
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node) break;
          const rect = sibling.getBoundingClientRect();
          if (rect.height === 0) continue;
          firstRowStack.push({
            el: `${sibling.tagName.toLowerCase()}${
              typeof sibling.className === "string" && sibling.className
                ? `.${sibling.className.trim().split(/\s+/).join(".")}`
                : ""
            }`,
            top: Math.round(rect.top + window.scrollY),
            height: Math.round(rect.height),
          });
        }
        node = parent;
      }
    }

    const interactive = [
      ...document.querySelectorAll(
        ".f9-notif-page a, .f9-notif-page button, .f9-notif-page input, .f9-notif-page select, .f9-notif-page textarea",
      ),
    ];
    const smallTargets = interactive
      .filter((node) => {
        const style = getComputedStyle(node);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          node.getAttribute("aria-hidden") === "true" ||
          node.hasAttribute("disabled")
        ) {
          return false;
        }
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (
          node instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(node.type)
        ) {
          const labelRect = node.closest("label")?.getBoundingClientRect();
          if (
            labelRect &&
            labelRect.width >= 43.5 &&
            labelRect.height >= 43.5
          ) {
            return false;
          }
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
        [...document.querySelectorAll(".f9-notif-page, .f9-notif-page *")]
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

test.describe("BL-039 live proof", () => {
  test.skip(!ENABLED, "set BL039_CAPTURE=1 to write the phase evidence set");
  test.setTimeout(20 * 60 * 1000);

  test("captures every GA plan and the 320-2560 overflow sweep", async ({
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
          const screenshot = path.join(
            OUT_DIR,
            `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`,
          );
          await page.screenshot({ path: screenshot, fullPage: true });

          metrics.push({
            surface: surface.name,
            user: surface.user,
            viewport: viewport.name,
            theme,
            resolvedTheme: measured.theme,
            docHeight: measured.docHeight,
            horizontalOverflow: measured.overflow,
            firstRowTop: measured.firstRowTop,
            firstRowStack: measured.firstRowStack,
            filledButtons: measured.filledButtons,
            filledInAnyViewport: measured.filledInAnyViewport,
            greenPainted: paint.hits.length,
            greenPaintedDetail: paint.hits,
            greenFocusReservations: paint.focusReservations.length,
            capsMono: paint.capsMono.length,
            capsMonoDetail: paint.capsMono,
            smallTargets: measured.smallTargets,
            ruleWeights: measured.ruleWeights,
            consoleErrors,
            pageErrors,
            screenshot: path.basename(screenshot),
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
              `${surface.name} ${viewport.name} ${theme}: ${paint.hits.length} painted greens`,
            );
          }
          if (paint.capsMono.length > 3) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${paint.capsMono.length} caps-mono surfaces`,
            );
          }
          if (measured.filledInAnyViewport > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${measured.filledInAnyViewport} filled buttons share one viewport`,
            );
          }
          if (measured.smallTargets.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: targets under 44px — ${measured.smallTargets.join(", ")}`,
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
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
        });
        await prepare(context, base, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
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
      path.join(OUT_DIR, `${PREFIX}-metrics.json`),
      `${JSON.stringify(
        { capturedAt: new Date().toISOString(), metrics, sweep },
        null,
        2,
      )}\n`,
    );

    expect(
      failures,
      "greens <=1, caps-mono <=3, one filled button per viewport, 1px rules, 44px targets, zero console errors, zero horizontal scroll 320-2560",
    ).toEqual([]);
  });
});
