import { expect, test } from "@playwright/test";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "../app/routes";

import { consoleFailures, ownDocument404For, watchConsole, type ConsoleEntry } from "./inbox";

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
  test(`${target} logs no console errors`, async ({ page }, testInfo) => {
    const watched = watchConsole(page);

    const response = await page.goto(target);
    await page.waitForLoadState("networkidle");

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

test.fail("the collector catches a deliberate console error", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  await page.goto("/");
  const caught = page.waitForEvent("console", { predicate: (message) => message.type() === "error" });
  await page.evaluate(() => console.error("deliberate console error"));
  await caught;
  expect(await consoleFailures(page, watched, testInfo)).toEqual([]);
});

test.fail("the collector catches a deliberate page error", async ({ page }, testInfo) => {
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
