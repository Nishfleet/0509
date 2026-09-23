import { expect, test } from "@playwright/test";

test("a row expands in place at 1440 and opens a bottom sheet at 390", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url}`);
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const response = await page.goto("/design/row-sheet");
  expect(response?.status()).toBe(200);

  const trigger = page.getByRole("button", { name: "Kindred" });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-slot='row-panel']")).toHaveCount(0);
  await expect(page.locator("[data-slot='row-sheet']")).toHaveCount(0);

  const rowBox = await page.locator("[data-slot='row']").boundingBox();
  await trigger.click();

  const phone = (page.viewportSize()?.width ?? 0) < 860;
  if (phone) {
    const sheet = page.locator("[data-slot='row-sheet']");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Kindred" })).toBeVisible();
    await expect(sheet).toContainText("detail");
    await expect(page.locator("[data-slot='row-panel']")).toHaveCount(0);
    const sheetBox = await sheet.boundingBox();
    const viewport = page.viewportSize();
    expect(sheetBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (sheetBox && viewport) {
      expect(sheetBox.y + sheetBox.height).toBeGreaterThan(viewport.height * 0.8);
      expect(sheetBox.height).toBeLessThan(viewport.height);
    }
    const rowAfter = await page.locator("[data-slot='row']").boundingBox();
    expect(rowAfter?.y).toBeCloseTo(rowBox?.y ?? -1, 0);

    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    await expect(sheet).toBeVisible();
    await page.locator("[data-slot='row-sheet-backdrop']").click({ position: { x: 8, y: 8 } });
    await expect(sheet).toHaveCount(0);

    await trigger.click();
    await expect(sheet).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(trigger).toBeFocused();
  } else {
    const panel = page.locator("[data-slot='row-panel']");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText("detail");
    await expect(panel).toHaveCSS("border-left-width", "4px");
    await expect(panel).toHaveCSS("border-left-color", "rgb(22, 196, 127)");
    await expect(page.locator("[data-slot='row-sheet']")).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const rowAfter = await page.locator("[data-slot='row']").boundingBox();
    expect((rowAfter?.height ?? 0)).toBeGreaterThan(rowBox?.height ?? 0);
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(errors, testInfo.project.name).toEqual([]);
});
