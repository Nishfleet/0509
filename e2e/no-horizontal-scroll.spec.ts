import { expect, test, type Page } from "@playwright/test";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "../app/routes";

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

async function measure(page: Page) {
  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

for (const target of targets) {
  test(`${target} has no horizontal scroll at 390`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "phone-390", "measured at 390 only");
    await page.goto(target);
    await page.waitForLoadState("networkidle");
    const m = await measure(page);
    expect(m.scrollWidth, JSON.stringify(m)).toBe(m.clientWidth);
  });
}

test.fail("a deliberately overflowing element fails the check", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390", "measured at 390 only");
  await page.goto("/");
  await page.evaluate(() => {
    const d = document.createElement("div");
    d.style.width = "800px";
    d.style.height = "1px";
    document.body.append(d);
  });
  const m = await measure(page);
  expect(m.scrollWidth, JSON.stringify(m)).toBe(m.clientWidth);
});
