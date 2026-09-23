import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// Production lane only, same as J1: the local preview Worker has no EMAIL
// binding and no inbox to read. Both viewport projects (1440px, 390px) run
// this spec; the scroll assertion is what each project is for.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "the competitors screen needs a real session, and the local preview Worker can neither send nor receive email",
);

test("the competitors screen renders tracking, maybe and add-completing surfaces", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${message.text()} @ ${message.location().url}`);
  });
  page.on("pageerror", (error) => errors.push(error.message));

  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, token);

  const response = await page.goto("/app/competitors");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Competitors");
  await expect(page.getByRole("heading", { name: "Tracking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Maybe" })).toBeVisible();

  const input = page.locator('input[name="competitor"]');
  const emptyWorkspace = await page.getByText("Your workspace is still being set up.").count();
  if (emptyWorkspace === 0) {
    await expect(input).toBeVisible();
    await input.fill("e2e-unresolvable-brand-zzz.example");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByRole("status")).toBeVisible();
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow, `horizontal scroll at ${testInfo.project.name}`).toBe(false);
  expect(errors, testInfo.project.name).toEqual([]);
});
