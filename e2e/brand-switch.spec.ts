import { expect, test } from "@playwright/test";

for (const colorScheme of ["light", "dark"] as const) {
  test(`the three switch states render in ${colorScheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    const response = await page.goto("/design/brand-switch");
    expect(response?.status()).toBe(200);

    const kindred = page.getByRole("switch", { name: "Kindred tracking" });
    await expect(kindred).toHaveAttribute("aria-checked", "true");

    const casetta = page.getByRole("switch", { name: "Casetta tracking" });
    await expect(casetta).toHaveAttribute("aria-checked", "false");

    const loopwell = page.getByRole("switch", { name: "Loopwell tracking" });
    await expect(loopwell).toHaveAttribute("data-disabled", "");

    await expect(page.getByText("paused 22 Sept · history kept")).toBeVisible();

    const boxes = await page.locator("[data-slot='brand-switch']").evaluateAll((elements) =>
      elements.map((el) => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    );
    expect(boxes).toHaveLength(3);
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);

    await testInfo.attach(`brand-switch-${colorScheme}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });
}

test("Tab reaches the switch and Space toggles it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/design/brand-switch");

  const kindred = page.getByRole("switch", { name: "Kindred tracking" });
  for (let i = 0; i < 20; i += 1) {
    if (await kindred.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(kindred).toBeFocused();
  await expect(kindred).toHaveCSS("outline-style", "solid");
  await expect(kindred).toHaveAccessibleDescription(/Off stops the watching and the alerts/);

  await page.keyboard.press("Space");
  await expect(kindred).toHaveAttribute("aria-checked", "false");
  const kindredRow = page
    .locator("[data-slot='brand-switch-row']")
    .filter({ hasText: "Kindred" });
  await expect(kindredRow).toHaveAttribute("data-state", "off");
  await expect(kindredRow).toContainText("paused 22 Sept · history kept");

  await page.keyboard.press("Space");
  await expect(kindred).toHaveAttribute("aria-checked", "true");
});
