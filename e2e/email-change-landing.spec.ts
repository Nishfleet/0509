import { isLocalLane, seedPreviewSession } from "./inbox";
import { scanPage, seedCompetitor, seedWorkspace, signIn, startQuality } from "./quality";
import { expect, test } from "./test";

test.skip(!isLocalLane(), "seeds a workspace in the local preview database; never run against production");

test.setTimeout(120_000);

test("Settings says what happened after each change-email link and nothing for a failed or unknown one", async ({
  page,
  baseURL,
}, testInfo) => {
  const quality = await startQuality(page);
  const { cookie } = await seedPreviewSession("email-landing", ({ db, suffix, userId }) => {
    seedCompetitor(db, suffix, seedWorkspace(db, suffix, userId));
  });
  await signIn(page, baseURL, cookie);

  await page.goto("/app/settings");
  const form = page.locator("form").filter({ hasText: "Change the email you sign in with" });
  await expect(form.getByRole("status")).toHaveCount(0);

  await page.goto("/app/settings?email=approved");
  await expect(form.getByRole("status")).toHaveText(
    "Approved. We sent a confirmation link to the new address. Nothing changes until you open it.",
  );
  await scanPage(page, testInfo, quality, `/app/settings email approved ${testInfo.project.name}`, {
    screen: /^settings$/i,
    keyboard: true,
  });

  await page.goto("/app/settings?email=changed");
  await expect(form.getByRole("status")).toHaveText(/^Done\. You sign in with \S+@\S+ now\.$/);

  await page.goto("/app/settings?email=changed&error=INVALID_TOKEN");
  await expect(form.getByRole("status")).toHaveCount(0);

  await page.goto("/app/settings?email=whatever");
  await expect(form.getByRole("status")).toHaveCount(0);
});
