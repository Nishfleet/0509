import { expect, test } from "./test";

import { expectFaceLoaded } from "./fonts";
import { consoleFailures, watchConsole } from "./inbox";

test("the landing page renders its headline and its contact link @smoke", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toBeVisible();
  await expect(headline).not.toBeEmpty();

  const contact = page.locator('a[href="mailto:support@0509.io"]');
  await expect(contact).toBeVisible();
  await expect(contact).toHaveAccessibleName(/\S/);
});

test("the landing page does not scroll horizontally @smoke", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("the landing headline is the largest paint and uses the brand display face @smoke", async ({ page }) => {
  await page.goto("/");

  const lcpTag = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        new PerformanceObserver((list) => {
          const last = list
            .getEntries()
            .filter((entry) => entry instanceof LargestContentfulPaint)
            .at(-1);
          resolve(last?.element?.tagName ?? "");
        }).observe({ type: "largest-contentful-paint", buffered: true });
      }),
  );
  expect(lcpTag).toBe("H1");

  await expectFaceLoaded(page, "Bricolage Grotesque");

  const headlineFamily = await page
    .getByRole("heading", { level: 1 })
    .evaluate((node) => getComputedStyle(node).fontFamily);
  expect(headlineFamily).toContain("Bricolage Grotesque");
});

test("/api/health answers ok @smoke", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    status: string;
    app: string;
    d1: string;
    timestamp: string;
    commit: string;
  };
  expect(body.status).toBe("ok");
  expect(body.app).toBe("0509");
  expect(body.d1).toBe("ok");
  expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  if (process.env.PLAYWRIGHT_TEST_BASE_URL) {
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
  } else {
    expect(typeof body.commit).toBe("string");
  }
});

test("the login page renders the one input that signs you in @smoke", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).not.toBeEmpty();

  const email = page.locator('input[type="email"][name="email"]');
  await expect(email).toBeVisible();
  await expect(email).toHaveAccessibleName(/\S/);
  await expect(page.locator('button[type="submit"]')).toBeEnabled();

  await expect(page.getByRole("button", { name: /passkey/i })).toBeEnabled();
  await expect(page.locator('link[rel="modulepreload"]')).not.toHaveCount(0);
  const contact = page.locator('footer a[href="mailto:support@0509.io"]');
  await expect(contact).toBeVisible();
  await expect(contact).toHaveAccessibleName(/\S/);
});

test("the page reaches first paint with no console errors @smoke", async ({ page }, testInfo) => {
  const watched = watchConsole(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
