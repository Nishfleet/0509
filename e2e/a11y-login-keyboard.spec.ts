import { expect, test } from "@playwright/test";

// #4148: the /login screens expose the three landmarks, the Tab order reaches
// every action, the sent state moves focus to its heading, and the resend wait
// is announced once, not every second.
test("/login keyboard path, landmarks and the sent-state announcement (#4148)", async ({ page }) => {
  await page.clock.install();
  await page.goto("/login");

  const landmarks = ["banner", "main", "contentinfo"] as const;
  for (const role of landmarks) {
    await expect(page.getByRole(role)).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  }

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Five to Nine" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email")).toBeFocused();
  await test.info().attach("focus-email", { body: await page.screenshot(), contentType: "image/png" });

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Email me a link" })).toBeFocused();
  await test.info().attach("focus-submit", { body: await page.screenshot(), contentType: "image/png" });

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Use a passkey instead" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "support@0509.io" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Privacy" })).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Terms" })).toBeFocused();

  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  await page.getByLabel("Email").focus();
  await page.getByLabel("Email").fill(email);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
  for (const role of landmarks) {
    await expect(page.getByRole(role)).toHaveCount(1);
  }

  await expect(page.getByRole("status")).toHaveText("You can send it again in 30 seconds.");
  await page.clock.runFor(31_000);
  await expect(page.getByRole("status")).toHaveText("You can send it again now.");
});
