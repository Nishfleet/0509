import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.describe("choosing which emails reach the delivery address", () => {
  test.skip(!isLocalLane(), "the seeded session only exists on the preview Worker");

  test("stopping the weekly brief keeps alerts on, and the choice survives a reload", async ({ page, baseURL }) => {
    const { cookie } = await seedPreviewSession("mailkinds", ({ db, suffix, userId }) => {
      run(
        db,
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
        `ws-${suffix}`,
        "Mail Kinds",
        userId,
        "2026-10-12T00:00:00.000Z",
      );
    });
    await page.context().addCookies(
      cookie.split("; ").map((pair) => {
        const [name, ...value] = pair.split("="),
          joined = value.join("=");
        return { name, value: joined, url: baseURL ?? "" };
      }),
    );
    await page.goto("/app/settings");
    const section = page.getByRole("region", { name: "Emails to this address" });
    await expect(section.getByLabel("The weekly brief")).toBeChecked();
    await section.getByLabel("The weekly brief").focus();
    await page.keyboard.press("Space");
    await expect(section.getByLabel("The weekly brief")).not.toBeChecked();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(section.getByRole("button", { name: "Update choices" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(section.getByRole("status")).toHaveText("Email choices saved.");

    await page.goto("/app/settings");
    const again = page.getByRole("region", { name: "Emails to this address" });
    await expect(again.getByLabel("The weekly brief")).not.toBeChecked();
    await expect(again.getByLabel("Alerts, when a competitor changes or your site has trouble")).toBeChecked();
  });
});
