import { expect, test } from "@playwright/test";

import { extractMagicLink, readRawMessage, requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J14 needs a real session; the local preview Worker can neither send nor receive email",
);

test("J14: an account that owns a brand, deleted from settings, leaves nothing behind and gets no email after", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  const token = requireInboxToken();
  const { link } = await signInWithMagicLink(page, email, token);

  await page.goto("/onboarding");
  const subject = page.getByRole("textbox", { name: "your website, or a handle" });
  await subject.fill("fixture.0509.in");
  await subject.press("Enter");
  await expect(page).toHaveURL(/\/onboarding\/identity\?subject=fixture\.0509\.in$/);
  await page.getByRole("button", { name: "edit name" }).click({ timeout: 45_000 });
  const name = page.getByRole("textbox", { name: "name" });
  await name.fill("Fixture Brand");
  await name.press("Escape");
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/);

  const cardBefore = await page.request.get("/app/share.png");
  expect(cardBefore.status()).toBe(404);

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
  const removedAt = new Date().toISOString();

  await page.screenshot({ path: test.info().outputPath("deleted.png") });

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  const cardAfter = await page.request.get("/app/share.png", { maxRedirects: 0 });
  expect(cardAfter.status()).not.toBe(200);

  const waitMs = 300_000 - (Date.now() % 300_000) + 60_000;
  await page.waitForTimeout(waitMs);
  const raw = await readRawMessage(email, token);
  expect(extractMagicLink(raw)).toBe(link);

  console.log(
    `J14 email=${email} instance=${instanceId} cardBefore=${cardBefore.status()} cardAfter=${cardAfter.status()} removedAt=${removedAt} quietUntil=${new Date().toISOString()}`,
  );
});
