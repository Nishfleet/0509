import { expect, test } from "@playwright/test";

test.describe("public production-safe E2E smoke", () => {
  test("public pages and machine-readable surfaces render without auth", async ({ page, baseURL, request }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByText("Five to Nine catches the change")).toBeVisible();
    await expect(page.getByText("WhatsApp", { exact: false })).toHaveCount(0);

    await page.goto("/search");
    await expect(page.getByRole("heading", { name: "Find competitor ads" })).toBeVisible();

    await page.goto("/auth/login");
    await expect(page.getByRole("heading", { name: "Return to the changes your team is watching." })).toBeVisible();

    await page.goto("/auth/signup");
    await expect(page.getByRole("heading", { name: "Start with the competitor your team keeps checking by hand." })).toBeVisible();

    await page.goto("/bots/presence");
    await expect(page.getByRole("heading", { name: "FiveToNinePresenceBot" })).toBeVisible();

    for (const path of ["/help", "/trust", "/privacy", "/terms", "/docs", "/changelog", "/api/docs"]) {
      const response = await page.goto(path);
      expect(response?.ok(), `${path} should return 2xx`).toBeTruthy();
      await expect(page.locator("body")).toBeVisible();
    }

    const health = await request.get(new URL("/api/health", baseURL).toString());
    expect(health.ok()).toBeTruthy();
    await expect(await health.json()).toMatchObject({ app: "0509", status: "ok" });

    const llms = await request.get(new URL("/llms.txt", baseURL).toString());
    expect(llms.ok()).toBeTruthy();
    expect(await llms.text()).toContain("Five to Nine");

    const invalidShare = await page.goto("/share/not-a-real-share-token");
    expect(invalidShare?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText("The requested page could not be found.")).toBeVisible();
  });
});
