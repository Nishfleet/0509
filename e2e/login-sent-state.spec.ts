import { expect, test } from "./test";

import { clearAppSession, consoleFailures, deleteCreatedAccount, settleSignInWidget, watchConsole } from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);

  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

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

test("a stale session lands on sign-in with a calm explanation", async ({ page, baseURL }) => {
  const host = new URL(baseURL ?? "http://localhost").hostname;
  await page
    .context()
    .addCookies([{ name: "better-auth.session_token", value: "stale.value", domain: host, path: "/" }]);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login\?.*ended=1/);
  await expect(page.getByRole("alert")).toContainText("You were signed out");
  await clearAppSession(page);
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});

test("clearing the app session leaves the Cloudflare Access cookie alone", async ({ page, baseURL }) => {
  const host = new URL(baseURL ?? "http://localhost").hostname;
  await page.context().addCookies([
    { name: "CF_Authorization", value: "access", domain: host, path: "/" },
    { name: "better-auth.session_token", value: "session", domain: host, path: "/" },
    { name: "__Secure-better-auth.session_token", value: "secure", domain: host, path: "/", secure: true },
  ]);
  await clearAppSession(page);
  const cleared = (await page.context().cookies()).map((cookie) => cookie.name);
  expect(cleared).toContain("CF_Authorization");
  expect(cleared.filter((name) => name.endsWith("better-auth.session_token"))).toEqual([]);
});
