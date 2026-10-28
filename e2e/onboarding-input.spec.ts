import { expect, test } from "./test";

import { consoleFailures, deleteCreatedAccount, requireInboxToken, signInWithMagicLink, watchConsole } from "./inbox";

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

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "screen 1 needs a signed-in session; the preview lane cannot read the magic-link inbox",
);

test("the one input posts and redirects every non-empty value to the card @own-signin", async ({ page }, testInfo) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;

  await signInWithMagicLink(page, email, token);

  const input = page.getByRole("textbox", { name: /your website address or social username/i });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/onboarding");
    const watched = watchConsole(page);

    await expect(page.getByRole("navigation", { name: "Onboarding progress" })).toBeVisible();
    await expect(input).toBeFocused();

    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);

    await input.press("Enter");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("status")).toContainText("find a website or username in that");
    await expect(input).toBeFocused();

    expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");

    for (const value of ["nike.com", "@nike", "qzxv wplk 9981"]) {
      await page.goto("/onboarding");
      await input.fill(value);
      await input.press("Enter");
      const expected = `/onboarding/identity?subject=${encodeURIComponent(value)}`;
      await expect(page).toHaveURL((url) => url.pathname + url.search === expected);
    }
  }
});
