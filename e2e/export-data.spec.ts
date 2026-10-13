import { expect, test } from "./test";

import { onboardedStatePath } from "../playwright.config";
import { isLocalLane, run, seedPreviewSession } from "./inbox";

test("the data export sends a signed-out visitor to the login page @smoke", async ({ request }) => {
  const response = await request.get("/app/settings/export", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toMatch(/\/login/);
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

test.describe("a signed-in export on the preview Worker", () => {
  test.skip(!isLocalLane(), "production covers the export with the kept onboarded account above");

  test("returns a JSON file with the account, the workspace and the brand it holds", async ({ page, baseURL }) => {
    const { cookie } = await seedPreviewSession("export", ({ db, suffix, userId }) => {
      const stamp = "2026-10-12T00:00:00.000Z";
      run(
        db,
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
        `ws-${suffix}`,
        "Export Preview",
        userId,
        stamp,
      );
      run(
        db,
        "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Export Brand', ?)",
        `ent-self-${suffix}`,
        `ws-${suffix}`,
        `export-${suffix}.example`,
        stamp,
      );
    });
    await page.context().addCookies(
      cookie.split("; ").map((pair) => {
        const [name, ...value] = pair.split("=");
        return { name, value: value.join("="), url: baseURL ?? "" };
      }),
    );
    const response = await page.request.get("/app/settings/export");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toMatch(/application\/json/);
    expect(response.headers()["content-disposition"]).toMatch(/attachment; filename="five-to-nine-export-/);
    const body = (await response.json()) as { brands: { name?: string }[]; account: { signInEmail: string } };
    expect(body.account.signInEmail).toMatch(/^export-[0-9a-f]{8}@0509\.io$/);
    expect(body.brands.map((brand) => brand.name)).toContain("Export Brand");
  });
});
