import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

function sha256(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

async function expectAuthenticatedRoute(page: import("@playwright/test").Page, path: string, heading: string) {
  const response = await page.goto(path);
  expect(response?.ok(), `${path} should return a successful response`).toBe(true);
  await expect(page).not.toHaveURL(/\/auth\/login/);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
}

test.describe("production authenticated smoke with owner-captured auth state", () => {
  test.beforeAll(() => {
    try {
      execFileSync(process.execPath, ["scripts/e2e-validate-auth-state.mjs"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
      throw new Error(`Production auth-state validation failed before browser launch: ${output}`);
    }
  });

  test("internal account can reach core authenticated surfaces without magic-link automation", async ({ page }) => {
    await page.goto("/app");
    await expect(page).not.toHaveURL(/\/auth\/login/);
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();

    await page.goto("/app/account");
    await expect(page.getByRole("heading", { name: "Account & security" })).toBeVisible();

    const expectedEmailHash = process.env.E2E_INTERNAL_ACCOUNT_EMAIL_SHA256?.trim().toLowerCase();
    expect(expectedEmailHash, "E2E_INTERNAL_ACCOUNT_EMAIL_SHA256 is required").toMatch(/^[a-f0-9]{64}$/);
    const accountEmail = await page.locator("body").evaluate((body) => {
      const text = (body as HTMLElement).innerText;
      return text.match(/Signed in as\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)?.[1] ?? null;
    });
    expect(accountEmail, "account email should be visible in the signed-in account copy").toBeTruthy();
    expect(sha256(accountEmail!)).toBe(expectedEmailHash);

    for (const route of [
      { path: "/app/billing", heading: "Billing & usage" },
      { path: "/app/watchlists", heading: "Watchlists" },
      { path: "/app/presence", heading: "Proof-backed entity tracking" },
      { path: "/app/notifications", heading: "Notifications" },
      { path: "/app/source-access", heading: "Source access" },
      { path: "/app/developer-access", heading: "Developer access" },
      { path: "/app/support", heading: "Help & support" },
    ]) {
      await expectAuthenticatedRoute(page, route.path, route.heading);
    }
  });
});
