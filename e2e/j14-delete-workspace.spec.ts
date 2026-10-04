import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J14 needs a real session; the local preview Worker can neither send nor receive email",
);

test("J14: a fresh account deleted from settings leaves nothing signed in and its files removed @own-signin", async ({
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
  const jar = (await page.context().cookies()).map(
    (c) => `${c.name} path=${c.path} secure=${String(c.secure)} sameSite=${c.sameSite} domain=${c.domain}`,
  );
  console.log(`J14 diag cookies: ${JSON.stringify(jar)}`);
  console.log(
    `J14 diag url=${page.url().replace(instanceId, "<id>")} sections=${String(await page.locator("section[data-delete]").count())}`,
  );

  const asked = await page.request.get(`/login?deleted=${encodeURIComponent(instanceId)}`);
  const askedHtml = await asked.text();
  console.log(
    `J14 diag page.request html status=${String(asked.status())} hasNotice=${String(askedHtml.includes("Your account is deleted"))} len=${String(askedHtml.length)}`,
  );
  const asData = await page.request.get(`/login.data?deleted=${encodeURIComponent(instanceId)}`);
  const dataText = (await asData.text()).replaceAll(instanceId, "<id>");
  console.log(`J14 diag login.data status=${String(asData.status())} body=${dataText.slice(0, 600)}`);
  const after = (await page.context().cookies()).map((c) => c.name);
  console.log(`J14 diag cookies after requests: ${JSON.stringify(after)}`);
  await expect(page.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();

  await expect
    .poll(
      async () => {
        await page.goto("/login?deleted=" + encodeURIComponent(instanceId));
        return page.locator('section[data-delete="progress"]').innerText();
      },
      { timeout: 120_000, intervals: [5_000] },
    )
    .toMatch(/Saved page copies and screenshots: removed/);

  await page.screenshot({ path: test.info().outputPath("deleted.png") });

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  console.log(`J14 email=${email} instance=${instanceId} removedAt=${new Date().toISOString()}`);
});
