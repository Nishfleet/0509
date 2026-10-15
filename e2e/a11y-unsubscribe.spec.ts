import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { expectKeyboardReachesVisibleFocus, expectNoAxeViolations } from "./quality";

test.describe("the unsubscribe pages by keyboard", () => {
  test.skip(!isLocalLane(), "the seeded send target only exists on the preview Worker");

  test("confirm, stop only the brief, then stop everything, never leaving the keyboard", async ({ page }, testInfo) => {
    const token = crypto.randomUUID().replaceAll("-", "");
    await seedPreviewSession("unsubkeys", ({ db, suffix, userId }) => {
      run(
        db,
        "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
        `ws-${suffix}`,
        "Unsub Keys",
        userId,
        "2026-10-12T00:00:00.000Z",
      );
      run(
        db,
        "INSERT INTO send_target (id, workspace_id, channel_id, target_value, is_verified, created_at, unsubscribe_token) SELECT ?, ?, id, ?, 1, ?, ? FROM channel WHERE key = 'email'",
        `st-${suffix}`,
        `ws-${suffix}`,
        `unsub-${suffix}@example.com`,
        "2026-10-12T00:00:00.000Z",
        token,
      );
    });

    await page.goto(`/u/${token}?type=brief`);
    await expect(page.getByRole("heading", { level: 1, name: "Stop the weekly brief?" })).toBeVisible();
    await expectNoAxeViolations(page, testInfo, "unsubscribe confirm");
    await expectKeyboardReachesVisibleFocus(page, "unsubscribe confirm");

    await page.getByRole("button", { name: "Unsubscribe" }).focus();
    await page.keyboard.press("Enter");
    const done = page.getByRole("heading", { level: 1, name: "You're unsubscribed" });
    await expect(done).toBeFocused();
    await expectNoAxeViolations(page, testInfo, "unsubscribe done");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Stop everything instead" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Stop everything instead" })).toHaveCount(0);
    await expect(done).toBeFocused();
    await expect(page.getByText("the weekly brief and all alerts")).toBeVisible();
  });
});
