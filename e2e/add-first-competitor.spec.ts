import { expect, test } from "./test";

import { isLocalLane, seedPreviewSession } from "./inbox";
import { seedWorkspace, signIn } from "./quality";

test.skip(
  !isLocalLane(),
  "seeds a workspace with no competitor in the local preview database; never run against production",
);

test("adding the first competitor from Home shows it is working, then lands it", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession("first-rival", ({ db, suffix, userId }) => {
    seedWorkspace(db, suffix, userId);
  });
  await signIn(page, baseURL, cookie);

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/app\/competitors(\.data)?(\?|$)/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await held;
    await route.continue();
  });

  await page.goto("/app");
  await expect(page.getByText("Add a competitor to see where you stand.")).toBeVisible();
  const field = page.getByLabel("Add a competitor", { exact: true });
  await field.fill("example.com");
  await field.press("Enter");

  await expect(page.getByRole("status").filter({ hasText: "Adding. We're reading their site now." })).toBeVisible();
  await expect(field).toBeDisabled();

  release();
  await expect(page.getByRole("status").filter({ hasText: "Adding." })).toHaveCount(0);
  await page.goto("/app/competitors");
  await expect(page.locator('[data-slot="competitor-count"]')).toContainText(
    "Watching 1 of 5 competitors on your plan.",
  );
});
