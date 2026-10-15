import type { Page } from "@playwright/test";
import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";
import { seedCompetitor, seedWorkspace, signIn } from "./quality";

test.skip(!isLocalLane(), "seeds a never-found rival in the local preview database; never run against production");

async function openRival(page: Page, baseURL: string | undefined, reason: string | null) {
  const suffix = { value: "" };
  const { cookie } = await seedPreviewSession("not-found", ({ db, suffix: id, userId }) => {
    suffix.value = id;
    const entityId = seedCompetitor(db, id, seedWorkspace(db, id, userId));
    run(
      db,
      "INSERT INTO page (id, entity_id, url, role, transport_reason, discovered_at) VALUES (?, ?, ?, 'home', ?, '2026-10-12T00:00:00.000Z')",
      `page-nf-${id}`,
      entityId,
      `https://zephyr-${id}.example/`,
      reason,
    );
  });
  await signIn(page, baseURL, cookie);
  await page.goto(`/app/competitors/ent-z-${suffix.value}`);
}

test("a rival whose site could not be found asks the customer to check the address", async ({ page, baseURL }) => {
  await openRival(page, baseURL, "unreachable");
  const note = page.locator('[data-slot="site-not-found"]');
  await expect(note).toContainText("We couldn't find their website. Check that the address is spelled right.");
  await expect(page.locator('[data-slot="site-unreadable"]')).toHaveCount(0);
  await expect(page.getByText("We couldn't find the homepage. Check the address.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
    0,
  );
});

test("a rival that was never marked unreachable keeps the first-read wording", async ({ page, baseURL }) => {
  await openRival(page, baseURL, null);
  await expect(page.locator('[data-slot="site-not-found"]')).toHaveCount(0);
  await expect(page.getByText(/First read tonight/)).toBeVisible();
});
