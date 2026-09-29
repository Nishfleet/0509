import { expect, test } from "@playwright/test";

import { deleteCreatedAccount, isLocalLane, requireInboxToken, signInWithMagicLink } from "./inbox";

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

// J3 from docs/REBUILD-DONE.md §A: one input becomes a confirmed brand card
// in under 30 s, a competitor list in under 60 s, and Home's first-file
// panel names a real arrival time. Timings come from the test's own clock.
// Two lanes: production mails through the inbox Worker; the preview lane's
// wrangler dev simulates send_email and inbox.ts reads the link from its sink.

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`J3 onboards gymshark.com inside its budgets at ${width} @own-signin`, async ({ page }) => {
    // The journey's own budget reaches 60 s from the input, after the
    // magic-link sign-in, so the test timeout has to clear that ceiling.
    test.setTimeout(150_000);
    const token = isLocalLane() ? null : requireInboxToken();
    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
    createdEmail = email;

    await page.setViewportSize({ width, height });
    await signInWithMagicLink(page, email, token);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/onboarding");
    const input = page.getByRole("textbox", { name: "your website, or a handle" });
    await input.fill("gymshark.com");
    const started = Date.now();
    await input.press("Enter");

    const editName = page.getByRole("button", { name: "edit name" });
    await expect(editName).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
    await page.getByRole("button", { name: "That's me" }).click();
    await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 30_000 });
    const cardConfirmedMs = Date.now() - started;
    test.info().annotations.push({
      type: "input-to-card-confirmed-ms",
      description: String(cardConfirmedMs),
    });
    expect(cardConfirmedMs).toBeLessThan(30_000);

    const listed = page
      .getByRole("list", { name: "Watching" })
      .getByRole("listitem")
      .or(page.getByRole("list", { name: "Maybe" }).getByRole("listitem"));
    await expect(listed.first()).toBeVisible({ timeout: 60_000 });
    const competitorsMs = Date.now() - started;
    test.info().annotations.push({
      type: "input-to-competitors-ms",
      description: String(competitorsMs),
    });
    expect(competitorsMs).toBeLessThan(60_000);

    const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
    if ((await watching.count()) === 0) {
      await page.getByRole("button", { name: /^Watch / }).first().click();
      await expect(watching.first()).toBeVisible();
    }
    await page.getByRole("button", { name: "Start watching" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const panel = page.locator('[data-home="first-file"]');
    await expect(panel).toContainText(
      /The first site snapshots land by (?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) (?:[01]\d|2[0-3]):[0-5]\d;/,
    );
    await expect(panel).not.toContainText("as soon as the first sweep is scheduled");
    const homeMs = Date.now() - started;
    test.info().annotations.push({
      type: "input-to-home-first-file-ms",
      description: String(homeMs),
    });

    expect(consoleErrors).toEqual([]);

    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);

    test.info().annotations.push({ type: "domain", description: "gymshark.com" });
    await test.info().attach(`j3-home-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}
