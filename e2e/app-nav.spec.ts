import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// The signed-in nav walk, production only — exactly like J1: the preview
// Worker has no EMAIL binding and no inbox to read, so it cannot mint a
// session, and this spec skips there rather than fake the journey. It runs in
// the `e2e-production` job after deploy. A fresh address has no self entity,
// so Home (`/app`) redirects to `/onboarding`; Home is therefore the last step
// of each walk and asserts `/onboarding`, not `/app`.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the nav walk needs a real session; the local preview Worker can neither send nor receive email",
);

test("a signed-in user reaches the four places by tapping and by Tab+Enter", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  const nav = page.getByRole("navigation", { name: "Places" });
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // Tapping: start at Competitors by URL, then walk the nav by click, and end
  // on Home — a fresh address has no self entity, so /app lands on /onboarding.
  await page.goto("/app/competitors");
  await expect(page.getByRole("heading", { name: "Competitors" })).toBeVisible();
  expect(await noOverflow()).toBe(0);
  await page.screenshot({ path: test.info().outputPath("competitors.png") });

  for (const [place, path] of [
    ["Alerts", "/app/alerts"],
    ["Settings", "/app/settings"],
  ] as const) {
    await nav.getByRole("link", { name: place }).click();
    await page.waitForURL(new RegExp(path + "$"));
    await expect(page.getByRole("heading", { name: place })).toBeVisible();
    await expect(nav.getByRole("link", { name: place })).toHaveAttribute("aria-current", "page");
    expect(await noOverflow()).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`${place.toLowerCase()}.png`) });
  }

  await nav.getByRole("link", { name: "Competitors" }).click();
  await page.waitForURL(/\/app\/competitors$/);
  await nav.getByRole("link", { name: "Home" }).click();
  await page.waitForURL(/\/onboarding$/);

  // Keyboard: a fresh page load before tabbing pins the count from the top of
  // the document — the nav is the first focusable content in the shell, so
  // Home = 1 Tab, Competitors = 2, Alerts = 3, Settings = 4.
  for (const [, path, tabs] of [
    ["Competitors", "/app/competitors", 2],
    ["Alerts", "/app/alerts", 3],
    ["Settings", "/app/settings", 4],
  ] as const) {
    await page.goto("/app/alerts");
    for (let index = 0; index < tabs; index += 1) {
      await page.keyboard.press("Tab");
    }
    const focused = page.locator(":focus");
    await expect(focused).toHaveAttribute("href", path);
    await expect(focused).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await page.waitForURL(new RegExp(path + "$"));
  }

  await page.goto("/app/alerts");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "/app");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/onboarding$/);

  expect(errors).toEqual([]);
});
