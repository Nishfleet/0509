import { expect, test } from "@playwright/test";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "../app/routes";

import { consoleFailures, ownDocument404For, prefetchRefused503, watchConsole, type ConsoleEntry } from "./inbox";

function screenPaths(entries: RouteConfigEntry[], parent: string): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.file.endsWith(".ts")) continue;
    const path = [parent, entry.path].filter(Boolean).join("/");
    if (entry.path !== undefined) paths.push(path);
    if (entry.children) paths.push(...screenPaths(entry.children, path));
  }
  return paths;
}

function visitPath(path: string): string {
  if (path === "*") return "/placeholder";
  return `/${path.replace(/:[^/]+/g, "placeholder")}`;
}

const targets = ["/", ...screenPaths(routes, "").map(visitPath)];

for (const target of targets) {
  test(`${target} logs no console errors @smoke`, async ({ page }, testInfo) => {
    const watched = watchConsole(page);

    const response = await page.goto(target);
    await expect(page.locator("main")).toBeVisible();

    const status = response?.status() ?? 0;
    const pageDocument404 = ownDocument404For(new URL(page.url()).pathname);
    // The status conjunct stays outside the shared predicate: the exclusion
    // holds only when the page itself answered 404 — a 200 page that logged a
    // "status of 404" line for the same path still fails.
    const ownDocument404 = (entry: ConsoleEntry) => status === 404 && pageDocument404(entry);

    if (status === 404) {
      expect(
        watched.consoleErrors.filter(pageDocument404),
        `${target} logs its own document 404 exactly once`,
      ).toHaveLength(1);
    }

    // The shared same-origin gate keeps this spec's own policy through its
    // `exclude` predicate: the document's own 404 line is expected (asserted
    // above), never a failure.
    const failures = await consoleFailures(page, watched, testInfo, ownDocument404);
    expect(failures, testInfo.project.name).toEqual([]);
  });
}

test.fail("the collector catches a deliberate console error @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  await page.goto("/");
  const caught = page.waitForEvent("console", { predicate: (message) => message.type() === "error" });
  await page.evaluate(() => console.error("deliberate console error"));
  await caught;
  expect(await consoleFailures(page, watched, testInfo)).toEqual([]);
});

test.fail("the collector catches a deliberate page error @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  await page.goto("/");
  const caught = page.waitForEvent("pageerror");
  // A synchronous throw inside evaluate is marshaled back to the evaluate
  // promise and never emits pageerror; a deferred throw is uncaught in the
  // page and does.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("deliberate page error");
    }, 0);
  });
  await caught;
  expect(await consoleFailures(page, watched, testInfo)).toEqual([]);
});

const PREFETCH_REFUSED = "prefetch refused: disabled for worker requests";

test("the collector drops a Cloudflare prefetch-refused 503 @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);
  await page.route("**/prefetch-refused.data", (route) =>
    route.fulfill({
      status: 503,
      headers: { "cf-speculation-refused": PREFETCH_REFUSED },
      body: "",
    }),
  );
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
  const caught = page.waitForEvent("console", {
    predicate: (message) => message.type() === "error" && /status of 503\b/.test(message.text()),
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const script = document.createElement("script");
        script.src = "/prefetch-refused.data";
        script.onload = () => {
          resolve();
        };
        script.onerror = () => {
          resolve();
        };
        document.head.appendChild(script);
      }),
  );
  await caught;
  expect(watched.prefetchRefused.some((url) => url.endsWith("/prefetch-refused.data"))).toBe(true);
  expect(watched.consoleErrors.filter(prefetchRefused503(watched.prefetchRefused))).not.toHaveLength(0);
  expect(await consoleFailures(page, watched, testInfo)).toEqual([]);
});

test("the collector still fails a same-origin 503 that is not prefetch-refused @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);
  await page.route("**/plain-503.data", (route) =>
    route.fulfill({
      status: 503,
      body: "",
    }),
  );
  await page.goto("/");
  await expect(page.locator("main")).toBeVisible();
  const caught = page.waitForEvent("console", {
    predicate: (message) => message.type() === "error" && /status of 503\b/.test(message.text()),
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const script = document.createElement("script");
        script.src = "/plain-503.data";
        script.onload = () => {
          resolve();
        };
        script.onerror = () => {
          resolve();
        };
        document.head.appendChild(script);
      }),
  );
  await caught;
  const failures = await consoleFailures(page, watched, testInfo);
  expect(failures.some((line) => /status of 503\b/.test(line) && line.includes("/plain-503.data"))).toBe(true);
});
