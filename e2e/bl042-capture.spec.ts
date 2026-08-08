import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * BL-042 live proof — the mobile top navigation shared by every signed-in
 * route. The three owner-required mobile surfaces are captured at 390px in
 * both themes; the same routes are swept from 320 through 2560. A plan-locked
 * Reports surface is also captured at 1440px in both themes so the deleted
 * desktop topbar is proved over a real non-happy child state. Whole-viewport
 * paint is recorded so inherited child-surface debt cannot disappear from the
 * report, while shell-law assertions are scoped to the shell this package owns.
 *
 * Opt in with `BL042_CAPTURE=1` and optionally set `BL042_OUT`.
 */
const ENABLED = process.env.BL042_CAPTURE === "1";
const OUT_DIR =
  process.env.BL042_OUT ?? path.resolve("test-results", "bl042-capture");

const SURFACES = [
  { name: "overview", url: "/app", user: "e2e-starter", current: "/app" },
  {
    name: "competitors",
    url: "/app/watchlists",
    user: "e2e-starter",
    current: "/app/watchlists",
  },
  { name: "briefs", url: "/app/digests", user: "e2e-starter", current: "/app/digests" },
] as const;
const DESKTOP_SURFACES = [
  {
    name: "reports-locked",
    url: "/app/reports",
    user: "e2e-free-onboarded",
    current: "/app/reports",
    state: "locked-feature",
  },
] as const;
const THEMES = ["light", "dark"] as const;
const SWEEP_WIDTHS = [
  320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560,
] as const;
const COMMON_ROUTE_HREFS = [
  "/app",
  "/app/watchlists",
  "/search",
  "/app/digests",
  "/app/collections",
  "/app/reports",
  "/app/shares",
  "/app/clients",
  "/app/notifications",
  "/app/source-access",
  "/app/developer-access",
  "/app/team",
  "/app/billing",
  "/app/account",
  "/app/support",
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
        "x-0509-e2e-search-rollout": "v2",
      },
    }),
  );
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem("f9-theme", value as string);
    } catch {
      /* storage disabled — the theme boot script falls back to light */
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

    const greenPainted: { element: string; property: string; value: string }[] = [];
    const navGreenPainted: { element: string; property: string; value: string }[] = [];
    const shellGreenPainted: {
      element: string;
      property: string;
      value: string;
    }[] = [];
    const capsMono: string[] = [];
    const navCapsMono: string[] = [];
    const shellCapsMono: string[] = [];
    const nav = document.querySelector(".f9-dash-mobile-nav");
    const shellRoots = [
      document.querySelector(".f9-wk-rail"),
      nav,
      document.querySelector(".f9-dash-topbar"),
    ].filter((node): node is Element => node !== null);
    const viewportHeight = window.innerHeight;
    for (const node of document.querySelectorAll("body *")) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) === 0) continue;
      const rect = node.getBoundingClientRect();
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        rect.bottom <= 0 ||
        rect.top >= viewportHeight
      ) {
        continue;
      }

      if (
        style.textTransform === "uppercase" &&
        style.fontFamily.toLowerCase().includes("mono") &&
        (node.textContent ?? "").trim()
      ) {
        const entry = `${label(node)}: ${(node.textContent ?? "").trim().slice(0, 48)}`;
        capsMono.push(entry);
        if (nav?.contains(node)) navCapsMono.push(entry);
        if (shellRoots.some((root) => root.contains(node))) shellCapsMono.push(entry);
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
          const entry = { element: label(node), property, value };
          greenPainted.push(entry);
          if (nav?.contains(node)) navGreenPainted.push(entry);
          if (shellRoots.some((root) => root.contains(node))) {
            shellGreenPainted.push(entry);
          }
        }
      }
    }
    return {
      capsMono,
      greenPainted,
      navCapsMono,
      navGreenPainted,
      shellCapsMono,
      shellGreenPainted,
    };
  });
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".f9-dash-mobile-nav");
    const navStyle = nav ? getComputedStyle(nav) : null;
    const desktopRail = document.querySelector<HTMLElement>(".f9-wk-rail");
    const desktopRailStyle = desktopRail ? getComputedStyle(desktopRail) : null;
    const desktopRailRect = desktopRail?.getBoundingClientRect() ?? null;
    const controls = nav
      ? [...nav.querySelectorAll<HTMLElement>("a, button")].map((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return {
            background: style.backgroundColor,
            borderBottomColor: style.borderBottomColor,
            borderBottomWidth: style.borderBottomWidth,
            fontFamily: style.fontFamily,
            fontWeight: style.fontWeight,
            height: Math.round(rect.height * 10) / 10,
            href: node instanceof HTMLAnchorElement ? node.getAttribute("href") : null,
            text: node.textContent?.trim() ?? "",
            textTransform: style.textTransform,
            width: Math.round(rect.width * 10) / 10,
          };
        })
      : [];
    const active = nav
      ? [...nav.querySelectorAll<HTMLAnchorElement>('a[aria-current="page"]')].map(
          (node) => node.getAttribute("href"),
        )
      : [];
    const desktopActive = desktopRail
      ? [
          ...desktopRail.querySelectorAll<HTMLAnchorElement>(
            'a[aria-current="page"]',
          ),
        ].map((node) => node.getAttribute("href"))
      : [];
    const navRuleWeights = nav
      ? [
          ...new Set(
            [nav, ...nav.querySelectorAll("*")]
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
        ].sort()
      : [];
    const routeHrefs = controls
      .map((control) => control.href)
      .filter((href): href is string => href !== null);

    const allTargets = [
      ...document.querySelectorAll<HTMLElement>(
        "a, button, input, select, textarea, summary",
      ),
    ]
      .filter((node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width === 0 ||
          rect.height === 0 ||
          rect.bottom <= 0 ||
          rect.top >= window.innerHeight ||
          node.hasAttribute("disabled") ||
          node.getAttribute("aria-hidden") === "true"
        ) {
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
          ["checkbox", "radio"].includes(node.type)
        ) {
          const label = node.closest("label");
          const labelRect = label?.getBoundingClientRect();
          if (labelRect && labelRect.width >= 43.5 && labelRect.height >= 43.5) {
            return false;
          }
        }
        return rect.width < 43.5 || rect.height < 43.5;
      })
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return `${node.tagName.toLowerCase()}.${node.className} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      });

    const filledInAnyViewport = (() => {
      const viewportHeight = window.innerHeight;
      const boxes = [
        ...document.querySelectorAll<HTMLElement>(
          ".f9-wk-btn, .f9-evidence-cta--rank1",
        ),
      ]
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && rect.width > 0 && rect.height > 0;
        })
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            top: rect.top + window.scrollY,
            bottom: rect.bottom + window.scrollY,
          };
        });
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
    })();

    const firstRow = document.querySelector<HTMLElement>(".f9-wk-page .f9-wk-row");
    const firstRowTop = firstRow
      ? Math.round(firstRow.getBoundingClientRect().top + window.scrollY)
      : null;
    const firstRowStack = (() => {
      const page = document.querySelector(".f9-wk-page");
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
      return stack.sort((a, b) => a.top - b.top);
    })();

    return {
      active,
      allTargets,
      controls,
      docHeight: document.documentElement.scrollHeight,
      desktopActive,
      desktopRailBox: desktopRailRect
        ? {
            height: Math.round(desktopRailRect.height * 10) / 10,
            width: Math.round(desktopRailRect.width * 10) / 10,
          }
        : null,
      desktopRailDisplay: desktopRailStyle?.display ?? null,
      desktopRailVisibility: desktopRailStyle?.visibility ?? null,
      filledInAnyViewport,
      firstRowStack,
      firstRowTop,
      horizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
      navBackground: navStyle?.backgroundColor ?? null,
      navDisplay: navStyle?.display ?? null,
      navRuleWeights,
      navScrollWidth: nav?.scrollWidth ?? null,
      navClientWidth: nav?.clientWidth ?? null,
      routeHrefs,
      shellActionRows: document.querySelectorAll(".f9-dash-topbar").length,
      appliedTheme:
        document.documentElement.getAttribute("data-f9-theme") ?? "light",
    };
  });
}

test.describe("BL-042 mobile top navigation proof", () => {
  test.skip(!ENABLED, "set BL042_CAPTURE=1 to write the BL-042 evidence set");
  test.setTimeout(15 * 60 * 1000);

  test("captures mobile and desktop shell proof in both themes and sweeps 320-2560", async ({
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
        const context = await browser.newContext({
          viewport: { width: 390, height: 844 },
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
        const screenshot = `after-${surface.name}-390-${theme}.png`;
        await page.screenshot({
          path: path.join(OUT_DIR, screenshot),
          fullPage: true,
        });

        metrics.push({
          surface: surface.name,
          url: surface.url,
          user: surface.user,
          viewport: "390x844",
          state: "filed",
          theme,
          ...measured,
          capsMono: paint.capsMono.length,
          capsMonoDetail: paint.capsMono,
          greenPainted: paint.greenPainted.length,
          greenPaintedDetail: paint.greenPainted,
          navCapsMono: paint.navCapsMono.length,
          navCapsMonoDetail: paint.navCapsMono,
          navGreenPainted: paint.navGreenPainted.length,
          navGreenPaintedDetail: paint.navGreenPainted,
          shellCapsMono: paint.shellCapsMono.length,
          shellCapsMonoDetail: paint.shellCapsMono,
          shellGreenPainted: paint.shellGreenPainted.length,
          shellGreenPaintedDetail: paint.shellGreenPainted,
          consoleErrors,
          pageErrors,
          screenshot,
        });

        if (measured.navDisplay !== "flex") {
          failures.push(`${surface.name} ${theme}: mobile nav is ${measured.navDisplay}`);
        }
        if (measured.shellActionRows !== 0) {
          failures.push(`${surface.name} ${theme}: shell action row still renders`);
        }
        if (measured.active.length !== 1 || measured.active[0] !== surface.current) {
          failures.push(
            `${surface.name} ${theme}: aria-current ${JSON.stringify(measured.active)}`,
          );
        }
        const missingRoutes = COMMON_ROUTE_HREFS.filter(
          (href) => !measured.routeHrefs.includes(href),
        );
        const duplicateRoutes = measured.routeHrefs.filter(
          (href, index) => measured.routeHrefs.indexOf(href) !== index,
        );
        if (missingRoutes.length || duplicateRoutes.length) {
          failures.push(
            `${surface.name} ${theme}: missing ${missingRoutes.join(",") || "none"}; duplicates ${duplicateRoutes.join(",") || "none"}`,
          );
        }
        const boxedOrCapsControls = measured.controls.filter(
          (control) =>
            control.textTransform !== "none" ||
            control.fontFamily.toLowerCase().includes("mono") ||
            control.borderBottomWidth !== "1px",
        );
        if (boxedOrCapsControls.length) {
          failures.push(
            `${surface.name} ${theme}: nav controls break sentence-case hairline contract`,
          );
        }
        const smallNavControls = measured.controls.filter(
          (control) => control.width < 43.5 || control.height < 43.5,
        );
        if (smallNavControls.length) {
          failures.push(
            `${surface.name} ${theme}: nav targets under 44px — ${smallNavControls
              .map((control) => `${control.text} ${control.width}x${control.height}`)
              .join(", ")}`,
          );
        }
        if (measured.navRuleWeights.join(",") !== "1px") {
          failures.push(
            `${surface.name} ${theme}: nav rule weights ${measured.navRuleWeights.join(",")}`,
          );
        }
        if (paint.navCapsMono.length > 0) {
          failures.push(
            `${surface.name} ${theme}: ${paint.navCapsMono.length} caps-mono nav surfaces`,
          );
        }
        if (paint.navGreenPainted.length > 0) {
          failures.push(
            `${surface.name} ${theme}: ${paint.navGreenPainted.length} painted nav greens`,
          );
        }
        if (measured.filledInAnyViewport > 1) {
          failures.push(
            `${surface.name} ${theme}: ${measured.filledInAnyViewport} filled controls share a viewport`,
          );
        }
        // Whole-page target debt is preserved in `allTargets` for the intent
        // audit. BL-042's acceptance boundary is the shared shell nav, whose
        // complete control set is asserted above; child route controls remain
        // owned by their landing-language packages.
        if (measured.horizontalOverflow > 1) {
          failures.push(
            `${surface.name} ${theme}: horizontal overflow ${measured.horizontalOverflow}`,
          );
        }
        if (consoleErrors.length || pageErrors.length) {
          failures.push(
            `${surface.name} ${theme}: console/page errors — ${[
              ...consoleErrors,
              ...pageErrors,
            ].join(" | ")}`,
          );
        }
        await context.close();
      }
    }

    for (const surface of DESKTOP_SURFACES) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
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
        await expect(page.locator(".f9-wk-rail")).toBeVisible();
        const lockedFeature = page.locator(".f9-locked-feature");
        await expect(lockedFeature).toBeVisible();
        await expect(
          lockedFeature.getByRole("heading", { name: "Client-ready reports" }),
        ).toBeVisible();
        const measured = await measure(page);
        const paint = await auditPaint(page);
        const visibleText = await page
          .locator("#f9-main-content")
          .innerText();
        const screenshot = `after-${surface.name}-1440-${theme}.png`;
        await page.screenshot({
          path: path.join(OUT_DIR, screenshot),
          fullPage: true,
        });

        metrics.push({
          surface: surface.name,
          url: surface.url,
          user: surface.user,
          viewport: "1440x900",
          state: surface.state,
          theme,
          ...measured,
          capsMono: paint.capsMono.length,
          capsMonoDetail: paint.capsMono,
          greenPainted: paint.greenPainted.length,
          greenPaintedDetail: paint.greenPainted,
          navCapsMono: paint.navCapsMono.length,
          navCapsMonoDetail: paint.navCapsMono,
          navGreenPainted: paint.navGreenPainted.length,
          navGreenPaintedDetail: paint.navGreenPainted,
          shellCapsMono: paint.shellCapsMono.length,
          shellCapsMonoDetail: paint.shellCapsMono,
          shellGreenPainted: paint.shellGreenPainted.length,
          shellGreenPaintedDetail: paint.shellGreenPainted,
          consoleErrors,
          pageErrors,
          screenshot,
          visibleText,
        });

        if (measured.desktopRailDisplay === "none") {
          failures.push(`${surface.name} ${theme}: desktop rail is hidden`);
        }
        if (
          measured.desktopRailVisibility !== "visible" ||
          measured.desktopRailBox === null ||
          measured.desktopRailBox.width === 0 ||
          measured.desktopRailBox.height === 0
        ) {
          failures.push(
            `${surface.name} ${theme}: desktop rail is not visibly rendered`,
          );
        }
        if (
          measured.desktopActive.length !== 1 ||
          measured.desktopActive[0] !== surface.current
        ) {
          failures.push(
            `${surface.name} ${theme}: desktop aria-current ${JSON.stringify(measured.desktopActive)}`,
          );
        }
        if (measured.shellActionRows !== 0) {
          failures.push(`${surface.name} ${theme}: shell action row still renders`);
        }
        if (paint.shellCapsMono.length > 0) {
          failures.push(
            `${surface.name} ${theme}: ${paint.shellCapsMono.length} caps-mono shell surfaces`,
          );
        }
        if (paint.shellGreenPainted.length > 0) {
          failures.push(
            `${surface.name} ${theme}: ${paint.shellGreenPainted.length} painted shell greens`,
          );
        }
        if (measured.horizontalOverflow > 1) {
          failures.push(
            `${surface.name} ${theme}: horizontal overflow ${measured.horizontalOverflow}`,
          );
        }
        if (consoleErrors.length || pageErrors.length) {
          failures.push(
            `${surface.name} ${theme}: console/page errors — ${[
              ...consoleErrors,
              ...pageErrors,
            ].join(" | ")}`,
          );
        }
        await context.close();
      }
    }

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: 390, height: 900 },
        });
        await prepare(context, base, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}${surface.url}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(120);
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

    const captureSummary = {
      total: metrics.length,
      mobile390: metrics.filter(
        (metric) =>
          (metric as { viewport?: string }).viewport === "390x844",
      ).length,
      desktop1440: metrics.filter(
        (metric) =>
          (metric as { viewport?: string }).viewport === "1440x900",
      ).length,
      desktopLockedFeature: metrics.filter(
        (metric) =>
          (metric as { viewport?: string; state?: string }).viewport ===
            "1440x900" &&
          (metric as { state?: string }).state === "locked-feature",
      ).length,
    };
    writeFileSync(
      path.join(OUT_DIR, "after-metrics.json"),
      `${JSON.stringify({
        capturedAt: new Date().toISOString(),
        summary: {
          captures: captureSummary,
          sweepStates: sweep.length,
          failures,
        },
        metrics,
        sweep,
      }, null, 2)}\n`,
    );
    expect(
      failures,
      "zero shell greens/caps-mono/action rows, one mobile fill per viewport, one 1px mobile nav rule, 44px mobile targets, aria-current, every route once, locked desktop proof, zero errors/overflow",
    ).toEqual([]);
  });
});
