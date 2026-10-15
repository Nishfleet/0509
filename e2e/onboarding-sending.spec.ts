import { expect, test } from "./test";

import { isLocalLane, seedPreviewSession } from "./inbox";
import { seedBareWorkspace, signIn } from "./quality";

test.skip(
  !isLocalLane(),
  "signs a fresh account in through the local preview database; production sign-in needs the magic-link inbox",
);

test("the onboarding box shows it is sending, and cannot be pressed twice", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession(
    "onboard-send",
    ({ db, suffix, userId }) => {
      seedBareWorkspace(db, suffix, userId);
    },
    { livePlan: false },
  );
  await signIn(page, baseURL, cookie);

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/onboarding(\.data)?(\?|$)/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await held;
    await route.continue();
  });

  await page.goto("/onboarding");
  const input = page.getByRole("textbox", { name: /your website address or social username/i });
  const submit = page.getByRole("button", { name: "Continue" });
  await input.fill("example.com");
  await submit.click();

  await expect(submit).toBeDisabled();
  await expect(page.locator("form[aria-busy=true]")).toHaveCount(1);

  release();
  await expect(page.locator("form[aria-busy=true]")).toHaveCount(0);
});
