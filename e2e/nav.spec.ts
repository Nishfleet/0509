import { expect, test } from "@playwright/test";

const HREFS = ["/app", "/app/competitors", "/app/alerts", "/app/settings"] as const;

test("the four places are 44px links in order, a rail on desktop and a bottom bar on a phone, with no horizontal scroll", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const response = await page.goto("/design/nav");
  expect(response?.status()).toBe(200);

  const nav = page.getByRole("navigation", { name: "Places" });
  const links = nav.getByRole("link");
  await expect(links).toHaveCount(4);
  for (const [index, href] of HREFS.entries()) {
    await expect(links.nth(index)).toHaveAttribute("href", href);
    const box = await links.nth(index).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }

  const position = await nav.evaluate((element) => getComputedStyle(element).position);
  const first = await links.nth(0).boundingBox();
  const second = await links.nth(1).boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  if (width < 860) {
    expect(position).toBe("fixed");
    expect(first?.y).toBe(second?.y);
  } else {
    expect(position).toBe("static");
    expect(second?.y).toBeGreaterThan(first?.y ?? 0);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(errors).toEqual([]);
});

test("Tab reaches the four places in order with a visible focus ring and Enter follows one", async ({
  page,
}) => {
  const response = await page.goto("/design/nav");
  expect(response?.status()).toBe(200);

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "/app");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "/app/competitors");
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveAttribute("href", "/app/alerts");
  await expect(page.locator(":focus")).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/login$/);
});
