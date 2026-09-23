import { expect, test } from "@playwright/test";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "../app/routes";

interface ConsoleEntry {
  text: string;
  url: string;
}

function screenPaths(entries: RouteConfigEntry[], parent: string): string[] {
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.file.endsWith(".ts")) continue;
    if (entry.path) {
      const path = [parent, entry.path].filter(Boolean).join("/");
      paths.push(path);
      if (entry.children) paths.push(...screenPaths(entry.children, path));
    } else if (entry.children) {
      paths.push(...screenPaths(entry.children, parent));
    }
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
    const consoleErrors: ConsoleEntry[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      consoleErrors.push({ text: message.text(), url: message.location().url });
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(target);
    await page.waitForLoadState("networkidle");

    const status = response?.status() ?? 0;
    const pagePath = new URL(page.url()).pathname;
    const ownDocument404 = (entry: ConsoleEntry) =>
      status === 404 && /status of 404\b/.test(entry.text) && new URL(entry.url).pathname === pagePath;

    if (status === 404) {
      expect(
        consoleErrors.filter(ownDocument404),
        `${target} logs its own document 404 exactly once`,
      ).toHaveLength(1);
    }

    const failures = [
      ...consoleErrors
        .filter((entry) => !ownDocument404(entry))
        .map((entry) => `${entry.text} @ ${entry.url}`),
      ...pageErrors,
    ];
    expect(failures, testInfo.project.name).toEqual([]);
  });
}

test.fail("the collector catches a deliberate console error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url}`);
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  const caught = page.waitForEvent("console", { predicate: (message) => message.type() === "error" });
  await page.evaluate(() => console.error("deliberate console error"));
  await caught;
  expect(errors).toEqual([]);
});
