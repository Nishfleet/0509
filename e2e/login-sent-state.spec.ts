import { expect, test } from "@playwright/test";

import { consoleFailures, deleteCreatedAccount, settleSignInWidget, watchConsole } from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  // The delete failing is a test failure, not a reason to keep the address:
  // clearing in finally means the next test in this worker cannot try to
  // delete an account that is already gone.
  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

// #4015, DESIGN.md §2.2: the sent state lands in place and the resend counts down for 30 s.
test("the sent state lands in place and the resend waits 30 seconds with a visible count @own-signin", async ({
  page,
}, testInfo) => {
  const watched = watchConsole(page);

  await page.clock.install();

  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;
  await page.locator('input[name="email"]').fill(email);
  await settleSignInWidget(page);
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByText(email)).toBeVisible();

  const resend = page.getByRole("button", { name: /send it again/i });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText(/\d+s/);

  await page.clock.runFor(31_000);
  await expect(resend).toBeEnabled();
  await expect(resend).not.toHaveText(/\d+s/);

  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fitsViewport).toBe(true);

  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
