import { expect, test } from "@playwright/test";

import { onboardedStatePath } from "../playwright.config";

test("the data export sends a signed-out visitor to the login page @smoke", async ({ request }) => {
  const response = await request.get("/app/settings/export", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers()["location"]).toMatch(/\/login/);
  expect(response.headers()["content-disposition"] ?? "").not.toContain("attachment");
});

test.describe("a signed-in export", () => {
  test.skip(
    !process.env.PLAYWRIGHT_TEST_BASE_URL,
    "the export JSON needs a real session; the local preview Worker cannot mint one",
  );
  test.use({
    storageState: async ({}, use, testInfo) => {
      await use(onboardedStatePath(testInfo.project.name === "phone-390" ? "phone" : "desktop"));
    },
  });

  test("returns a JSON file that names the privacy-policy personal data (0509#7080)", async ({ page }) => {
    const response = await page.request.get("/app/settings/export");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/application\/json/);
    expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="five-to-nine-export-/);
    const body: unknown = await response.json();
    expect(body).toEqual(
      expect.objectContaining({
        account: expect.objectContaining({ signInEmail: expect.any(String) }),
        sessions: expect.any(Array),
        passkeys: expect.any(Array),
        agentKeys: expect.any(Array),
        plan: expect.objectContaining({ tier: expect.any(String) }),
        workspace: expect.anything(),
        brands: expect.any(Array),
        choices: expect.any(Array),
        decisions: expect.any(Array),
        incidents: expect.any(Array),
        signals: expect.any(Array),
        briefs: expect.any(Array),
      }),
    );
  });
});
