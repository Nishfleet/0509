import { expect, test } from "./test";

const PAGES = ["/pricing", "/privacy", "/terms"] as const;

for (const path of PAGES) {
  test(`${path} carries the same site header: wordmark, Overview and Sign in @smoke`, async ({ page }) => {
    await page.goto(path);

    await expect(page.getByRole("banner")).toHaveCount(1);
    const nav = page.getByRole("navigation", { name: "Site" });
    await expect(nav.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("href", "/");
    await expect(nav.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("banner").getByRole("link", { name: "Five to Nine" })).toHaveAttribute("href", "/");
  });
}

test("pricing opens on one headline and shows the plan buttons without scrolling on a laptop @smoke", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pricing");

  const headline = page.getByRole("heading", { level: 1 });
  await expect(headline).toHaveCount(1);
  await expect(headline).toHaveText("Pick how closely you watch.");
  await expect(page.getByRole("heading", { level: 2, name: "Pick how closely you watch." })).toHaveCount(0);

  const levels = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((els) => els.map((el) => Number(el.tagName.slice(1))));
  expect(levels[0]).toBe(1);
  for (let i = 1; i < levels.length; i += 1) {
    expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
  }

  const buttons = page.getByRole("link", { name: /^Start with / });
  await expect(buttons).toHaveCount(3);
  for (const index of [0, 1, 2]) {
    const box = await buttons.nth(index).boundingBox();
    expect(box?.y !== undefined && box.height > 0 && box.y + box.height <= 900, `plan button ${String(index)}`).toBe(
      true,
    );
  }
});
