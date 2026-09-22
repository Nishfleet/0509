import { expect, test } from "@playwright/test";

test("tab reaches the per-brand switch and space toggles it", async ({ page }) => {
  const response = await page.goto("/brand-switch?theme=light");
  expect(response?.status()).toBe(200);

  const kindred = page.getByRole("switch", { name: /Kindred/ });
  const casetta = page.getByRole("switch", { name: /Casetta/ });
  const you = page.getByRole("switch", { name: /Loopwell/ });

  await expect(kindred).toHaveAttribute("aria-checked", "true");
  await expect(you).toBeDisabled();

  const hit = page.locator('[data-slot="hit"]').first();
  const box = await hit.boundingBox();
  if (box === null) throw new Error("the switch hit target has no box");
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);

  await page.keyboard.press("Tab");
  await expect(kindred).toBeFocused();
  await page.keyboard.press("Space");
  await expect(kindred).toHaveAttribute("aria-checked", "false");

  await page.keyboard.press("Tab");
  await expect(casetta).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(you).not.toBeFocused();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
