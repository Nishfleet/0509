import { expect, test, type Page } from "@playwright/test";
import type { RouteConfigEntry } from "@react-router/dev/routes";
import routes from "../app/routes";
import { requireInboxToken, signInWithMagicLink } from "./inbox";

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
const signedInTargets = targets.filter((t) => t.startsWith("/app") || t.startsWith("/onboarding"));

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

test("every signed-in screen has no horizontal scroll at 390", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390", "measured at 390 only");
  test.skip(!process.env.PLAYWRIGHT_TEST_BASE_URL, "needs a real session; the preview Worker cannot send email");
  test.setTimeout(120_000);

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  let rows: Array<{ target: string; landed: string; scrollWidth: number; clientWidth: number }> = [];
  for (const t of signedInTargets) {
    await page.goto(t);
    await page.waitForLoadState("networkidle");
    const m = await measure(page);
    rows = [...rows, { target: t, landed: new URL(page.url()).pathname, ...m }];
  }
  await test.info().attach("widths", { body: JSON.stringify(rows, null, 2), contentType: "application/json" });
  expect(rows.filter((r) => r.scrollWidth !== r.clientWidth)).toEqual([]);
});

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
