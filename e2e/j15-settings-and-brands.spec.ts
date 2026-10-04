import { expect, test, type Page } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";

test.describe("J15 a signed-in customer changes settings and hits the plan limit", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "settings need a real session; the local preview Worker cannot mint one",
  );
  test.use({
    storageState: async ({}, use, testInfo) => {
      await use(onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop"));
    },
  });

  async function openSettings(page: Page): Promise<void> {
    await page.goto("/app/settings");
    await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  }

  test("J15 the brief day saves at once and is still there after a reload", async ({ page }) => {
    await openSettings(page);
    const day = page.getByRole("combobox", { name: "Day", exact: true });
    const before = await day.inputValue();
    const options = await day.locator("option").evaluateAll((all) => all.map((o) => (o as HTMLOptionElement).value));
    const next = options.find((value) => value !== before);
    expect(next).toBeDefined();
    await day.selectOption(next ?? before);
    await expect(page.getByText("Brief time saved")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Day", exact: true })).toHaveValue(next ?? before);
    await page.getByRole("combobox", { name: "Day", exact: true }).selectOption(before);
    await expect(page.getByText("Brief time saved")).toBeVisible();
  });

  test("J15 pausing the brief says so, survives a reload, and resuming undoes it", async ({ page }) => {
    await openSettings(page);
    await page.getByRole("button", { name: "Pause the brief" }).click();
    await expect(page.getByText(/Paused since/)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Paused since/)).toBeVisible();
    await page.getByRole("button", { name: "Resume the brief" }).click();
    await expect(page.getByRole("button", { name: "Pause the brief" })).toBeVisible();
    await expect(page.getByText(/Paused since/)).toHaveCount(0);
  });

  test("J15 the own-site alerts switch keeps its state across a reload", async ({ page }) => {
    await openSettings(page);
    const control = (): ReturnType<Page["getByRole"]> =>
      page.getByRole("switch", { name: /Immediate alerts for your own site/ });
    const flip = async (): Promise<void> => {
      const saved = page.waitForResponse(
        (response) => response.request().method() === "POST" && response.url().includes("/app/settings"),
      );
      await control().click();
      await saved;
    };
    const was = await control().isChecked();
    await flip();
    await page.reload();
    await expect(control()).toBeChecked({ checked: !was });
    await flip();
    await page.reload();
    await expect(control()).toBeChecked({ checked: was });
  });

  test("J15 a delivery address that is not an email is stopped and not saved", async ({ page }) => {
    await openSettings(page);
    const field = page.locator("#delivery-address-input");
    const original = await field.inputValue();
    await field.fill("not-an-email");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(await field.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
    await page.reload();
    await expect(page.locator("#delivery-address-input")).toHaveValue(original);
  });

  test("J15 adding a brand at the plan limit says so and offers the upgrade", async ({ page }) => {
    await page.goto("/app/competitors");
    await page.locator("#add-competitor").fill("example.org");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(/Your plan watches up to \d+ competitors/)).toBeVisible();
    await expect(page.getByRole("button", { name: /^Upgrade to / })).toBeVisible();
  });
});
