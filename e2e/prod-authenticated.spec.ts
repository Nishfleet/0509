import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

function sha256(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

test.describe("production authenticated smoke with owner-captured auth state", () => {
  test("internal account can reach core authenticated surfaces without magic-link automation", async ({ page }) => {
    await page.goto("/app");
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    await page.goto("/app/account");
    await expect(page.getByRole("heading", { name: "Account & security" })).toBeVisible();

    const expectedEmailHash = process.env.E2E_INTERNAL_ACCOUNT_EMAIL_SHA256?.trim().toLowerCase();
    if (expectedEmailHash) {
      const visibleText = await page.locator("body").innerText();
      const emailMatch = visibleText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      expect(emailMatch, "account email should be visible for workspace guard").toBeTruthy();
      expect(sha256(emailMatch![0])).toBe(expectedEmailHash);
    }

    for (const path of ["/app/billing", "/app/watchlists", "/app/sources", "/app/support"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/auth\/login/);
      await expect(page.locator("body")).toBeVisible();
    }
  });
});
