import { expect, test } from "./test";

import { isLocalLane, seedPreviewSession } from "./inbox";
import { seedBareWorkspace, signIn } from "./quality";

test("an anonymous visitor sees Sign in on the homepage and no Open app link", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open app" })).toHaveCount(0);
});

test("a signed-in visitor sees Open app on the homepage in place of Sign in", async ({ page, baseURL }) => {
  test.skip(
    !isLocalLane(),
    "signs a fresh account in through the local preview database; production sign-in needs the magic-link inbox",
  );
  const { cookie } = await seedPreviewSession(
    "landing-open-app",
    ({ db, suffix, userId }) => {
      seedBareWorkspace(db, suffix, userId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  const open = page.getByRole("link", { name: "Open app" });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute("href", "/app");
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});
