import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J14 needs a real session; the local preview Worker can neither send nor receive email",
);

test("J14: a fresh account deleted from settings leaves nothing signed in and its files removed", async ({
  page,
}) => {
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();

  await page.getByLabel("Type " + email + " to confirm").fill(email);
  await page.getByRole("button", { name: "Delete my account" }).click();

  await page.waitForURL(/\/login\?deleted=/);
  const instanceId = new URL(page.url()).searchParams.get("deleted") ?? "";
  expect(instanceId).not.toBe("");

  await expect(page.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();

  await expect
    .poll(
      async () => {
        await page.goto("/login?deleted=" + encodeURIComponent(instanceId));
        return page.locator('section[data-delete="progress"]').innerText();
      },
      { timeout: 120_000, intervals: [5_000] },
    )
    .toMatch(/Snapshots and screenshots: removed/);

  await page.screenshot({ path: test.info().outputPath("deleted.png") });

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  console.log(`J14 email=${email} instance=${instanceId} removedAt=${new Date().toISOString()}`);
});
