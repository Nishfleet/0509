import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const ENABLED = process.env.BL037_CAPTURE === "1";
const OUT_DIR =
  process.env.BL037_OUT ?? "/home/nish/workspaces/products/0509-audit-artifacts-bl037";
const PREFIX = process.env.BL037_PREFIX ?? "after";

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1080 },
] as const;
const THEMES = ["light", "dark"] as const;
const SWEEP_WIDTHS = [320, 360, 390, 414, 480, 640, 768, 1024, 1280, 1440, 1600, 1920, 2560];

const SURFACES = [
  { name: "agency-empty", user: "e2e-agency-unbranded", mode: "empty" },
  { name: "agency-composer", user: "e2e-agency-unbranded", mode: "composer" },
  { name: "starter-locked", user: "e2e-starter", mode: "locked" },
  { name: "agency-room", user: "e2e-agency", mode: "room" },
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

async function seedAgencyRoom(page: Page) {
  const response = await page.request.post("/api/e2e/j4/replay", {
    headers: { "x-0509-e2e-test-mode": "1" },
    data: {
      userId: "e2e-agency",
      runId: "e2e-run-j4-client-room-1440x900",
      idempotencyKey: "e2e-j4-client-room-1440x900",
      scenario: "j4",
      clock: new Date().toISOString(),
    },
  });
  expect(response.status(), "the fixture room must be available for populated captures").toBe(200);
}

async function openSurface(
  page: Page,
  mode: (typeof SURFACES)[number]["mode"],
) {
  if (mode === "room") {
    await seedAgencyRoom(page);
  }
  await page.goto("/app/clients", { waitUntil: "networkidle" });
  if (mode === "empty" || mode === "composer") {
    await expect(
      page.locator(".f9-client-room-card"),
      `${mode} proof must use an Agency fixture with no persisted rooms`,
    ).toHaveCount(0);
  }
  if (mode === "composer") {
    await page.getByRole("button", { name: "Create client room" }).click();
    await expect(page.getByRole("button", { name: "Save client room" })).toBeVisible();
  }
  if (mode === "room") {
    await expect(page.locator(".f9-client-room-card").first()).toBeVisible();
  }
  // The shared Settle token is 260ms. Measure stable target geometry after it
  // completes so transforms cannot turn an authored 44px control into 43.99px.
  await page.waitForTimeout(320);
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".f9-wk-page");
    if (!root) throw new Error("Client rooms did not render the landing-language page");

    const label = (node: Element) =>
      `${node.tagName.toLowerCase()}${
        typeof node.className === "string" && node.className
          ? `.${node.className.trim().split(/\s+/).join(".")}`
          : ""
      }`;
    const visible = (node: Element) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const absoluteBox = (node: Element) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top + window.scrollY,
        bottom: rect.bottom + window.scrollY,
      };
    };
    const worstWindow = (boxes: Array<{ top: number; bottom: number }>) => {
      if (boxes.length === 0) return 0;
      const height = window.innerHeight;
      const count = (start: number) =>
        boxes.filter((box) => box.bottom > start && box.top < start + height).length;
      return Math.max(
        ...boxes.flatMap((box) => [count(box.top), count(box.bottom - height)]),
      );
    };

    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.opacity = "0";
    document.body.appendChild(probe);
    const rootStyle = getComputedStyle(document.documentElement);
    const greenTokens = new Set<string>();
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
      probe.style.color = raw;
      greenTokens.add(getComputedStyle(probe).color);
    }
    const normalizeColour = (value: string) => {
      probe.style.color = "";
      probe.style.color = value;
      return probe.style.color ? getComputedStyle(probe).color : value;
    };

    const colours = (value: string) => {
      const candidates = new Set([value, normalizeColour(value)]);
      return [...candidates].flatMap((candidate) => {
        const rgb = [...candidate.matchAll(/rgba?\(([^)]+)\)/g)].map((match) => {
          const channels = match[1].split(/[,/\s]+/).filter(Boolean).map(Number);
          return {
            raw: `rgb(${channels.slice(0, 3).join(", ")})`,
            r: channels[0],
            g: channels[1],
            b: channels[2],
            a: channels[3] ?? 1,
          };
        });
        const srgb = [...candidate.matchAll(/color\(\s*srgb\s+([^)]+)\)/g)].flatMap(
          (match) => {
            const channels = match[1].split(/[/\s]+/).filter(Boolean).map(Number);
            if (channels.length < 3 || channels.some(Number.isNaN)) return [];
            const [r, g, b] = channels.slice(0, 3).map((channel) => channel * 255);
            return [{
              raw: `rgb(${r}, ${g}, ${b})`,
              r,
              g,
              b,
              a: channels[3] ?? 1,
            }];
          },
        );
        return [...rgb, ...srgb];
      });
    };
    const isGreen = (value: string) =>
      colours(value).some(
        (colour) =>
          colour.a > 0.04 &&
          (greenTokens.has(colour.raw) ||
            (colour.g > colour.r + 20 && colour.g > colour.b + 20)),
      );

    const greenNodes: Array<{
      element: string;
      properties: string[];
      top: number;
      bottom: number;
    }> = [];
    const focusReservations: Array<{ element: string; value: string }> = [];
    for (const node of root.querySelectorAll("*")) {
      if (!visible(node)) continue;
      const style = getComputedStyle(node);
      const properties: string[] = [];
      const candidates: Array<[string, string]> = [
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
        if (width !== "0px" && borderStyle !== "none") {
          candidates.push([
            `border-${side.toLowerCase()}`,
            style[`border${side}Color` as "borderTopColor"],
          ]);
        }
      }
      if (style.textDecorationLine !== "none") {
        candidates.push(["text-decoration", style.textDecorationColor]);
      }
      for (const [property, value] of candidates) {
        if (value && value !== "none" && isGreen(value)) properties.push(property);
      }
      if (properties.length > 0) {
        greenNodes.push({ element: label(node), properties, ...absoluteBox(node) });
      }
      if (style.outlineStyle !== "none" && isGreen(style.outlineColor)) {
        focusReservations.push({ element: label(node), value: style.outlineColor });
      }
    }
    probe.remove();

    const filledBoxes = [...root.querySelectorAll(".f9-wk-btn")]
      .filter(visible)
      .map(absoluteBox);
    const capsMono = [...root.querySelectorAll("*")]
      .filter(visible)
      .filter((node) => {
        const style = getComputedStyle(node);
        return (
          style.textTransform === "uppercase" &&
          /IBM Plex Mono|monospace/i.test(style.fontFamily) &&
          Boolean(node.textContent?.trim())
        );
      })
      .map(label);

    const ruleWeights = [
      ...new Set(
        [root, ...root.querySelectorAll("*")]
          .flatMap((node) => {
            const style = getComputedStyle(node);
            return [
              [style.borderTopWidth, style.borderTopStyle],
              [style.borderRightWidth, style.borderRightStyle],
              [style.borderBottomWidth, style.borderBottomStyle],
              [style.borderLeftWidth, style.borderLeftStyle],
            ] as const;
          })
          .filter(([width, style]) => width !== "0px" && style !== "none")
          .map(([width]) => width),
      ),
    ].sort();

    const smallTargets = [
      ...root.querySelectorAll(
        "button, a, summary, input:not([type='hidden']):not([type='checkbox']), select, textarea, .f9-rooms-choice-row label",
      ),
    ]
      .filter(visible)
      .flatMap((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width >= 44 && rect.height >= 44
          ? []
          : [{ element: label(node), width: Math.round(rect.width), height: Math.round(rect.height) }];
      });

    const shadows = [root, ...root.querySelectorAll("*")]
      .filter(visible)
      .filter((node) => getComputedStyle(node).boxShadow !== "none")
      .map(label);
    const dashedBorders = [root, ...root.querySelectorAll("*")]
      .filter(visible)
      .filter((node) => {
        const style = getComputedStyle(node);
        return [
          style.borderTopStyle,
          style.borderRightStyle,
          style.borderBottomStyle,
          style.borderLeftStyle,
        ].includes("dashed");
      })
      .map(label);
    const nestedOverflows = [root, ...root.querySelectorAll("*")]
      .flatMap((node) => {
        const overflow = Math.max(0, node.scrollWidth - node.clientWidth);
        if (overflow <= 2) return [];
        if (
          node.classList.contains("f9-sr-only") ||
          node.classList.contains("ld-sr-only") ||
          node instanceof HTMLSelectElement
        ) {
          return [];
        }
        const style = getComputedStyle(node);
        if (
          style.display === "inline" ||
          style.display === "contents" ||
          ["auto", "scroll", "hidden", "clip"].includes(style.overflowX)
        ) {
          return [];
        }
        return [{ element: label(node), overflow }];
      });

    const firstRow = root.querySelector(
      ".f9-rooms-room > summary, .f9-rooms-choice-row, .f9-rooms-empty",
    );

    return {
      theme: document.documentElement.getAttribute("data-f9-theme") ?? "light",
      docHeight: document.documentElement.scrollHeight,
      horizontalOverflow: Math.max(
        0,
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      greenPainted: greenNodes,
      greenInAnyViewport: worstWindow(greenNodes),
      greenFocusReservations: focusReservations,
      filledButtons: filledBoxes.length,
      filledInAnyViewport: worstWindow(filledBoxes),
      capsMono,
      ruleWeights,
      smallTargets,
      shadows,
      dashedBorders,
      nestedOverflows,
      firstRowTop: firstRow
        ? Math.round(firstRow.getBoundingClientRect().top + window.scrollY)
        : null,
    };
  });
}

test.describe("BL-037 live proof", () => {
  test.skip(!ENABLED, "set BL037_CAPTURE=1 to write the client-room evidence set");
  test.setTimeout(15 * 60 * 1000);

  test("captures empty, locked, composer and populated states plus the width sweep", async ({
    browser,
    baseURL,
  }) => {
    mkdirSync(OUT_DIR, { recursive: true });
    const metrics: unknown[] = [];
    const sweep: unknown[] = [];
    const failures: string[] = [];
    let disclosureStateProof = false;

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        for (const viewport of VIEWPORTS) {
          const context = await browser.newContext({
            baseURL,
            viewport: { width: viewport.width, height: viewport.height },
            deviceScaleFactor: 2,
          });
          await prepare(context, baseURL!, surface.user, theme);
          const page = await context.newPage();
          const consoleErrors: string[] = [];
          const pageErrors: string[] = [];
          page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
          });
          page.on("pageerror", (error) => pageErrors.push(String(error)));

          await openSurface(page, surface.mode);
          const measured = await measure(page);
          const screenshot = `${PREFIX}-${surface.name}-${viewport.name}-${theme}.png`;
          await page.screenshot({
            path: path.join(OUT_DIR, screenshot),
            fullPage: true,
          });

          metrics.push({
            surface: surface.name,
            user: surface.user,
            viewport: viewport.name,
            theme,
            ...measured,
            consoleErrors,
            pageErrors,
            screenshot,
          });

          if (measured.horizontalOverflow > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: overflow ${measured.horizontalOverflow}`,
            );
          }
          if (measured.theme !== theme) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: observed theme ${measured.theme ?? "missing"}`,
            );
          }
          if (measured.greenInAnyViewport > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${measured.greenInAnyViewport} painted greens share a viewport`,
            );
          }
          if (measured.filledInAnyViewport > 1) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${measured.filledInAnyViewport} filled actions share a viewport`,
            );
          }
          if (measured.capsMono.length > 3) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: ${measured.capsMono.length} caps-mono surfaces`,
            );
          }
          if (measured.ruleWeights.some((width) => width !== "1px")) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: rule weights ${measured.ruleWeights.join(", ")}`,
            );
          }
          if (measured.smallTargets.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: undersized targets ${JSON.stringify(measured.smallTargets)}`,
            );
          }
          if (measured.shadows.length > 0 || measured.dashedBorders.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: shadows ${measured.shadows.length}, dashed borders ${measured.dashedBorders.length}`,
            );
          }
          if (measured.nestedOverflows.length > 0) {
            failures.push(
              `${surface.name} ${viewport.name} ${theme}: nested overflow ${JSON.stringify(measured.nestedOverflows)}`,
            );
          }
          if (consoleErrors.length > 0 || pageErrors.length > 0) {
            failures.push(`${surface.name} ${viewport.name} ${theme}: console/page errors`);
          }
          await context.close();
        }
      }
    }

    for (const surface of SURFACES) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          baseURL,
          viewport: { width: 1440, height: 900 },
        });
        await prepare(context, baseURL!, surface.user, theme);
        const page = await context.newPage();
        for (const width of SWEEP_WIDTHS) {
          await page.setViewportSize({ width, height: 900 });
          await openSurface(page, surface.mode);
          const overflow = await page.evaluate(() =>
            Math.max(
              0,
              document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
          );
          sweep.push({
            surface: surface.name,
            theme,
            width,
            horizontalOverflow: overflow,
          });
          if (overflow > 1) {
            failures.push(`sweep ${surface.name} ${theme} @${width}: overflow ${overflow}`);
          }
        }
        await context.close();
      }
    }

    const disclosureContext = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    await prepare(disclosureContext, baseURL!, "e2e-agency", "light");
    const disclosurePage = await disclosureContext.newPage();
    await openSurface(disclosurePage, "room");
    const firstRoom = disclosurePage.locator(".f9-client-room-card").first();
    await expect(firstRoom).toHaveAttribute("open", "");
    await firstRoom.locator("summary").click();
    await expect(firstRoom).not.toHaveAttribute("open", "");
    await disclosurePage.getByRole("button", { name: "Create client room" }).click();
    await expect(firstRoom).not.toHaveAttribute("open", "");
    await disclosurePage.getByRole("button", { name: "Cancel" }).click();
    await expect(firstRoom).not.toHaveAttribute("open", "");
    await firstRoom.locator("summary").click();
    await expect(firstRoom).toHaveAttribute("open", "");
    await disclosurePage.getByRole("button", { name: "Create client room" }).click();
    await expect(firstRoom).toHaveAttribute("open", "");
    await disclosurePage.getByRole("button", { name: "Cancel" }).click();
    await expect(firstRoom).toHaveAttribute("open", "");
    disclosureStateProof = true;
    await disclosureContext.close();

    writeFileSync(
      path.join(OUT_DIR, `${PREFIX}-metrics.json`),
      `${JSON.stringify({
        capturedAt: new Date().toISOString(),
        disclosureStateProof,
        metrics,
        sweep,
      }, null, 2)}\n`,
    );

    expect(
      failures,
      "BL-037 must keep every paint, hierarchy, target and overflow budget",
    ).toEqual([]);
  });
});
