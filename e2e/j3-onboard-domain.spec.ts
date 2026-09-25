import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// J3 from docs/REBUILD-DONE.md §A: one input becomes a confirmed brand card
// in under 30 s, a competitor list in under 60 s, and Home's first-file
// panel names a real arrival time. Timings come from the test's own clock.
// Production only: the preview lane's wrangler dev has no EMAIL binding and
// no inbox to read, so the whole spec skips there rather than fake the journey.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J3 needs a signed-in session; the preview lane cannot read the magic-link inbox",
);

for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`J3 onboards gymshark.com inside its budgets at ${width}`, async ({ page }) => {
    const token = requireInboxToken();
    const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

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
    expect(cardConfirmedMs).toBeLessThan(30_000);

    const listed = page
      .getByRole("list", { name: "Watching" })
      .getByRole("listitem")
      .or(page.getByRole("list", { name: "Maybe" }).getByRole("listitem"));
    await expect(listed.first()).toBeVisible({ timeout: 60_000 });
    const competitorsMs = Date.now() - started;
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

    expect(consoleErrors).toEqual([]);

    const noHorizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noHorizontalScroll).toBe(true);

    test.info().annotations.push(
      { type: "input-to-card-confirmed-ms", description: String(cardConfirmedMs) },
      { type: "input-to-competitors-ms", description: String(competitorsMs) },
      { type: "input-to-home-first-file-ms", description: String(homeMs) },
      { type: "domain", description: "gymshark.com" },
    );
    await test.info().attach(`j3-home-${width}`, {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });
}
