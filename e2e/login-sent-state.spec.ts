import { expect, test } from "./test";

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
  testInfo.setTimeout(120_000);
  const watched = watchConsole(page);

  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;
  await page.locator('input[name="email"]').fill(email);
  await settleSignInWidget(page);
  // Real time, not page.clock: the sent state mounts a second Turnstile widget
  // after submit (startOn="mount"), and its iframe runs on whatever clock the
  // page has. Fake timers starve its scripts and they throw uncaught
  // pageerrors ("reading 'call'", "setting 'rqvo8'", 2026-10-11 run
  // 38146870606), which carry no URL to exclude. The 30 s wait is the real one.
  await page.locator('button[type="submit"]').click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('input[name="email"]')).toHaveCount(0);
  await expect(page.getByText(email)).toBeVisible();

  const resend = page.getByRole("button", { name: /send it again/i });
  await expect(resend).toBeDisabled();
  await expect(resend).toHaveText(/\d+s/);

  await expect(resend).toBeEnabled({ timeout: 40_000 });
  await expect(resend).not.toHaveText(/\d+s/);

  await page.getByRole("button", { name: "Use a different email" }).click();
  await expect(page.locator('input[name="email"]')).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  await expect(page.getByText("New or returning, we email you a link.")).toBeVisible();

  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  );
  expect(fitsViewport).toBe(true);

  expect(
    await consoleFailures(page, watched, testInfo, (entry) =>
      /^\[Cloudflare Turnstile\] Error: (200100|[36]\d{5})\.$/.test(entry.text),
    ),
    testInfo.project.name,
  ).toEqual([]);
});
