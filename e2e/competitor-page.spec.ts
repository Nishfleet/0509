import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

test("a competitor page sends a signed-out visitor to the login page", async ({ request }) => {
  const response = await request.get("/app/competitors/ent-anything", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/login/);
});

test("a change's screenshot is never served to a signed-out visitor", async ({ request }) => {
  for (const side of ["before", "after"]) {
    const response = await request.get(`/app/changes/sig-anything/${side}`, { maxRedirects: 0 });
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(response.headers()["location"]).toMatch(/\/login/);
    expect(response.headers()["content-type"] ?? "").not.toContain("image/");
  }
});

// The switch test against the real detail page, production only: the preview
// Worker has no EMAIL binding and no inbox to read, so it cannot mint a
// session, and this test skips there rather than fake the journey. The journey
// is J3's — gymshark.com onboarded through "Start watching" — because a real
// /app/competitors/:entityId page only exists once a competitor is watched.
test("a watched competitor page leads with the switch and its consequence, and turns off without a dialog", async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the competitor page needs a real session; the local preview Worker cannot mint one",
  );
  test.setTimeout(150_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await signInWithMagicLink(page, email, requireInboxToken());

  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: "your website, or a handle" });
  await input.fill("gymshark.com");
  await input.press("Enter");

  await expect(page.getByRole("button", { name: "edit name" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("looking on the site")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "That's me" }).click();
  await expect(page).toHaveURL(/\/onboarding\/competitors$/, { timeout: 30_000 });

  const watching = page.getByRole("list", { name: "Watching" }).getByRole("listitem");
  await expect(
    watching.first().or(page.getByRole("button", { name: /^Watch / }).first()),
  ).toBeVisible({ timeout: 60_000 });
  if ((await watching.count()) === 0) {
    await page.getByRole("button", { name: /^Watch / }).first().click();
    await expect(watching.first()).toBeVisible();
  }
  await page.getByRole("button", { name: "Start watching" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/competitors");
  await page.getByRole("list", { name: "Competitors" }).getByRole("link").first().click();
  await expect(page).toHaveURL(/\/app\/competitors\/[^/]+$/);

  const sentence = page.getByText("Off stops the watching and the alerts.", { exact: false });
  await expect(sentence).toBeVisible();

  // Exactly one switch on the detail page — the watched competitor's own, whose
  // aria-label is "<brand> tracking" (app/components/brand-switch.tsx).
  const toggle = page.getByRole("switch", { name: / tracking$/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("[data-slot='competitor-paused']")).toContainText("Paused");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);

  await testInfo.attach("app-competitor", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });

  expect(consoleErrors).toEqual([]);
});
