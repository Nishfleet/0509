import { type Locator, type Page } from "@playwright/test";

import { isLocalLane } from "./inbox";
import { signIn } from "./quality";
import { seedRankedHomeSession } from "./ranked-home";
import { expect, test } from "./test";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production has the dedicated journeys",
);

test.setTimeout(120_000);

const TAB_PRESSES = 14;

async function focusIsInside(page: Page, dialog: Locator): Promise<boolean> {
  return dialog.evaluate((element) => element.contains(document.activeElement));
}

async function expectFocusTrapped(page: Page, dialog: Locator, label: string): Promise<void> {
  await expect.poll(() => focusIsInside(page, dialog), { message: `${label}: focus starts inside` }).toBe(true);
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let press = 0; press < TAB_PRESSES; press += 1) {
      await page.keyboard.press(key);
      await expect
        .poll(() => focusIsInside(page, dialog), {
          message: `${label}: ${key} press ${String(press + 1)} stays inside`,
        })
        .toBe(true);
    }
  }
}

test("the how-this-is-ranked dialog opens from the keyboard, holds focus, closes on Escape and gives focus back", async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL, await seedRankedHomeSession("a11y-dialog-ranked"));
  await page.goto("/app");
  const trigger = page.getByRole("button", { name: "How this is ranked" });
  await trigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "How this is ranked" });
  await expect(dialog).toBeVisible();
  await expectFocusTrapped(page, dialog, "how this is ranked");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("the competitor sheet on a phone opens from the keyboard, holds focus, closes on Escape and gives focus back", async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "phone-390",
    "the sheet is the phone layout; wider screens expand the row in place",
  );
  await signIn(page, baseURL, await seedRankedHomeSession("a11y-dialog-sheet"));
  await page.goto("/app");
  const toggle = page
    .locator('[data-testid="standing-row"]', { hasText: "Kindred" })
    .locator('[data-slot="row-toggle"]');
  await toggle.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Kindred" });
  await expect(dialog).toBeVisible();
  await expectFocusTrapped(page, dialog, "competitor sheet");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeFocused();
});
