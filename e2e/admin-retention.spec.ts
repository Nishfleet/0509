import { expect, test } from "./test";

import { isLocalLane, seedPreviewSession } from "./inbox";
import { seedRankedHomeSession } from "./ranked-home";

test("the retention page sends a signed-out visitor to the login page @smoke", async ({ request }) => {
  const response = await request.get("/app/admin/retention", { maxRedirects: 0 });
  expect(response.status()).toBeGreaterThanOrEqual(300);
  expect(response.status()).toBeLessThan(400);
  expect(response.headers().location).toMatch(/\/login/);
});

test("the retention page answers a signed-in customer who is not the owner as if it did not exist", async ({
  request,
}) => {
  test.skip(!isLocalLane(), "seeds a workspace in the local preview database; never run against production");
  const cookie = await seedRankedHomeSession("retention-not-owner");
  const response = await request.get("/app/admin/retention", { headers: { cookie }, maxRedirects: 0 });
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain("Trial to paid");
});

test("the owner sees the retention board with counts and no address", async ({ page }) => {
  test.skip(!isLocalLane(), "the owner address is set only on the local preview Worker; never run against production");
  const { cookie } = await seedPreviewSession("retention-owner", () => undefined, {
    livePlan: true,
    email: "retention-owner@0509.io",
  });
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/admin/retention");
  await expect(page.getByRole("heading", { level: 1, name: "Retention" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Trial to paid, by signup week" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Last seen, live workspaces" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cancellations, by month" })).toBeVisible();
  await expect(page.getByRole("main")).not.toContainText("@");
});
