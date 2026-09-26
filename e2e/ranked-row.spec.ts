import { expect, test, type Page } from "@playwright/test";

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

function rankedRow(page: Page, name: string) {
  return page.locator('[data-testid="standing-row"]', { hasText: name });
}

test("a ranked row expands in place and the open param survives a reload", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "in-place expansion is the desktop layout");
  const consoleErrors = collectConsoleErrors(page);

  const response = await page.goto("/design/ranked-rows");
  expect(response?.status()).toBe(200);
  await page.evaluate(() => {
    (window as unknown as { __stay: number }).__stay = 1;
  });

  await rankedRow(page, "Kindred").locator('[data-slot="row-toggle"]').click();
  await expect(page).toHaveURL(/[?&]open=ent_kindred/);

  const row = rankedRow(page, "Kindred");
  await expect(row).toHaveAttribute("data-open", "true");
  const evidence = row.locator('[data-slot="row-evidence"]');
  await expect(evidence).toBeVisible();
  await expect(evidence.getByRole("tab", { name: "Site changes 2" })).toBeVisible();

  const stayed = await page.evaluate(() => (window as unknown as { __stay: number }).__stay);
  expect(stayed).toBe(1);

  await page.reload();
  await expect(page.locator('[data-slot="row-evidence"]')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("below 860px an open ranked row's evidence is a bottom sheet that clears the param", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone-390", "the sheet is the phone layout");
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/design/ranked-rows");
  await rankedRow(page, "Kindred").locator('[data-slot="row-toggle"]').click();
  await expect(page).toHaveURL(/[?&]open=ent_kindred/);

  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator('[data-slot="row-evidence"]')).toBeHidden();

  await page.addStyleTag({ content: "html, body { overflow-x: visible !important; }" });
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(m.scrollWidth, JSON.stringify(m)).toBe(m.clientWidth);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).not.toHaveURL(/[?&]open=/);

  expect(consoleErrors).toEqual([]);
});

test("a zero-signal row shows a dash and the self row's switch reads you", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/design/ranked-rows");
  await expect(rankedRow(page, "Casetta")).toContainText("—");
  await expect(
    page.locator('[data-testid="standing-row"][data-self="true"] [data-slot="brand-switch"]'),
  ).toHaveAttribute("data-state", "you");

  expect(consoleErrors).toEqual([]);
});
