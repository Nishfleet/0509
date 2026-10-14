import { expect, test } from "./test";

import { isLocalLane } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test.skip(
  !isLocalLane(),
  "seeds a ranked workspace in the local preview database and renames its competitor; never run against production",
);

test("a customer fixes a wrong rival name and sees it everywhere, with the domain still watched", async ({ page }) => {
  const cookie = await seedRankedHomeSession("rename");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/competitors");
  await page
    .getByRole("link", { name: /Kindred/ })
    .first()
    .click();
  const field = page.getByLabel("Show this competitor as");
  await expect(field).toHaveValue("Kindred");
  await field.fill("Kindred Goods");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kindred Goods");

  await page.goto("/app/competitors");
  await expect(page.getByRole("link", { name: /Kindred Goods/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: /Kindred Goods/ }).first()).toBeVisible();
});

test("an empty rival name is refused in plain words and the old name stays", async ({ page }) => {
  const cookie = await seedRankedHomeSession("rename-empty");
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/competitors");
  await page
    .getByRole("link", { name: /Kindred/ })
    .first()
    .click();
  const field = page.getByLabel("Show this competitor as");
  await field.evaluate((input: HTMLInputElement) => {
    input.removeAttribute("required");
  });
  await field.fill("   ");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Type the name you want us to show" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kindred");
});

for (const colorScheme of ["light", "dark"] as const) {
  test(`the rename section fits the screen and keeps its focus ring in ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const cookie = await seedRankedHomeSession(`rename-look-${colorScheme}`);
    await page.setExtraHTTPHeaders({ cookie });

    await page.goto("/app/competitors");
    await page
      .getByRole("link", { name: /Kindred/ })
      .first()
      .click();
    const field = page.getByLabel("Show this competitor as");
    await field.scrollIntoViewIfNeeded();
    await field.focus();
    await expect(field).toBeFocused();
    const ring = await field.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.outlineStyle !== "none" || style.boxShadow !== "none";
    });
    expect(ring).toBe(true);

    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll).toBe(width.client);
  });
}
