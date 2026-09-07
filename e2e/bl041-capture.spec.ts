import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-041 live proof for Team, Billing, and Account.
 *
 * Opt in with BL041_CAPTURE=1. The harness uses the release fixture server,
 * photographs owner/member and locked/unlocked states, and refuses to write a
 * passing set when the v4 budgets are breached.
 */
const ENABLED = process.env.BL041_CAPTURE === "1";
const OUT_DIR =
  process.env.BL041_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl041";
const PREFIX = process.env.BL041_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560];
const SURFACES = [
  { name: "team-locked", url: "/app/team", user: "e2e-starter" },
  { name: "team-owner", url: "/app/team", user: "e2e-agency" },
  { name: "team-member", url: "/app/team", user: "e2e-active-member" },
  { name: "billing-free", url: "/app/billing", user: "e2e-free" },
  { name: "billing-starter", url: "/app/billing", user: "e2e-starter" },
  { name: "billing-member", url: "/app/billing", user: "e2e-active-member" },
  { name: "account-locked", url: "/app/account", user: "e2e-starter" },
  { name: "account-agency", url: "/app/account", user: "e2e-agency" },
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
      // The boot script safely falls back to light when storage is disabled.
    }
  }, theme);
}

/**
 * Honest first-viewport paint audit. It resolves green tokens into computed
 * colours and also catches hardcoded green-dominant colours. Caps-mono is a
 * computed type decision, not a class-name count.
 */
async function auditPaint(page: Page) {
  return page.evaluate(() => {
    const pageRoot = document.querySelector(".f9-wk-page");
    if (!pageRoot) throw new Error("BL-041 page root is missing");

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
      probe.style.color = "";
      const baseline = getComputedStyle(probe).color;
      const raw = rootStyle.getPropertyValue(token).trim();
      if (!raw) continue;
      probe.style.color = raw;
      const resolved = getComputedStyle(probe).color;
      if (resolved && resolved !== baseline) tokenGreens.add(resolved);
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

    const green: { element: string; property: string; value: string }[] = [];
    const capsMono: string[] = [];
    const viewportHeight = window.innerHeight;
    for (const node of pageRoot.querySelectorAll("*")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom <= 0 || rect.top >= viewportHeight) continue;

      const family = style.fontFamily.toLowerCase();
      if (
        style.textTransform === "uppercase" &&
        (family.includes("mono") || family.includes("plex mono")) &&
        (node.textContent ?? "").trim().length > 0
      ) {
        capsMono.push(`${label(node)}: ${(node.textContent ?? "").trim().slice(0, 44)}`);
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
        if (value && value !== "none" && isGreen(value)) {
          green.push({ element: label(node), property, value });
        }
      }
    }
    return { tokenGreens: [...tokenGreens], green, capsMono };
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const pageRoot = document.querySelector(".f9-wk-page");
    if (!pageRoot) throw new Error("BL-041 page root is missing");
    const rootGrounds = new Set([
      getComputedStyle(pageRoot).backgroundColor,
      getComputedStyle(document.body).backgroundColor,
      "rgba(0, 0, 0, 0)",
      "transparent",
    ]);
    const label = (node: Element) =>
      `${node.tagName.toLowerCase()}${
        typeof node.className === "string" && node.className
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;
    const filled = [...pageRoot.querySelectorAll("a, button")]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (rect.width === 0 || rect.height === 0) return false;
        return (
          !rootGrounds.has(style.backgroundColor) ||
          (style.backgroundImage !== "none" && style.backgroundImage !== "")
        );
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          label: label(node),
          top: rect.top + window.scrollY,
          bottom: rect.bottom + window.scrollY,
        };
      });
    const viewportHeight = window.innerHeight;
    const countFilled = (start: number) =>
      filled.filter(
        (control) =>
          control.bottom > start && control.top < start + viewportHeight,
      ).length;
    const filledInAnyViewport =
      filled.length === 0
        ? 0
        : Math.max(
            ...filled.flatMap((control) => [
              countFilled(control.top),
              countFilled(control.bottom - viewportHeight),
            ]),
          );

    const smallTargets = [
      ...pageRoot.querySelectorAll("a, button, input, select, textarea"),
    ]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (rect.width === 0 || rect.height === 0) return false;
        if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("disabled")) {
          return false;
        }
        if (
          node.tagName === "A" &&
          style.display === "inline" &&
          node.closest("p, li, dd, .f9-wk-workrow > span")
        ) {
          return false;
        }
        if (node instanceof HTMLInputElement && node.type === "checkbox") {
          const owner = node.closest("label")?.getBoundingClientRect();
          if (owner && owner.width >= 43.5 && owner.height >= 43.5) return false;
        }
        return rect.width < 43.5 || rect.height < 43.5;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return `${label(node)} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      });

    const firstRow = pageRoot.querySelector(
      ".f9-acct-section, .f9-acct-lock, .f9-checkout-banner",
    );
    const rounded = [pageRoot, ...pageRoot.querySelectorAll("*")]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((node) => {
        const style = getComputedStyle(node);
        const radii = [
          style.borderTopLeftRadius,
          style.borderTopRightRadius,
          style.borderBottomRightRadius,
          style.borderBottomLeftRadius,
        ];
        return {
          label: label(node),
          radii,
          nonZero: radii.some((radius) =>
            [...radius.matchAll(/[\d.]+/g)].some((match) => Number(match[0]) > 0.1),
          ),
        };
      })
      .filter((entry) => entry.nonZero)
      .map(({ label: element, radii }) => `${element} ${radii.join("/")}`);
    return {
      theme: document.documentElement.getAttribute("data-f9-theme"),
      docHeight: document.documentElement.scrollHeight,
      horizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      filledButtons: filled.map((control) => control.label),
      filledInAnyViewport,
      firstRowTop: firstRow
        ? Math.round(firstRow.getBoundingClientRect().top + window.scrollY)
        : null,
      rounded,
      smallTargets,
      ruleWeights: [
        ...new Set(
          [pageRoot, ...pageRoot.querySelectorAll("*")]
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
    };
  });
}

test.describe("BL-041 live proof", () => {
  test.skip(!ENABLED, "set BL041_CAPTURE=1 to write the BL-041 evidence set");
  test.setTimeout(20 * 60 * 1000);

  test("captures every representative state and the 320-2560 overflow sweep", async ({
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
          const shellTopbarCount = await page.locator(".f9-dash-topbar").count();
          const screenshot = `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`;
          await page.screenshot({ path: path.join(OUT_DIR, screenshot), fullPage: true });

          metrics.push({
            surface: surface.name,
            url: surface.url,
            user: surface.user,
            viewport: viewport.name,
            theme,
            resolvedTheme: measured.theme,
            docHeight: measured.docHeight,
            horizontalOverflow: measured.horizontalOverflow,
            firstRowTop: measured.firstRowTop,
            greenPainted: paint.green.length,
            greenPaintedDetail: paint.green,
            capsMono: paint.capsMono.length,
            capsMonoDetail: paint.capsMono,
            filledButtons: measured.filledButtons,
            filledInAnyViewport: measured.filledInAnyViewport,
            rounded: measured.rounded,
            smallTargets: measured.smallTargets,
            ruleWeights: measured.ruleWeights,
            shellTopbarCount,
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
          if (shellTopbarCount > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: legacy shell topbar is still present`,
            );
          }
          if (measured.horizontalOverflow > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: horizontal overflow ${measured.horizontalOverflow}`,
            );
          }
          const firstRowRange =
            viewport.width < 600
              ? { min: 132, max: 176 }
              : { min: 96, max: 120 };
          if (
            measured.firstRowTop === null ||
            measured.firstRowTop < firstRowRange.min ||
            measured.firstRowTop > firstRowRange.max
          ) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: first row ${measured.firstRowTop ?? "missing"}px outside ${firstRowRange.min}-${firstRowRange.max}px`,
            );
          }
          if (paint.green.length > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${paint.green.length} painted greens — ` +
                paint.green.map((hit) => `${hit.element}{${hit.property}}`).join(", "),
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
              `${surface.name} ${viewport.name} ${theme}: ${measured.filledInAnyViewport} filled controls share a viewport — ` +
                measured.filledButtons.join(", "),
            );
          }
          if (measured.rounded.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: rounded geometry — ${measured.rounded.join(", ")}`,
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
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await prepare(context, base, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(100);
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
      "compressed first row, ≤1 green, ≤3 caps-mono, ≤1 filled action per viewport, radius 0, 1px rules, 44px targets, zero errors, zero overflow",
    ).toEqual([]);
  });
});
