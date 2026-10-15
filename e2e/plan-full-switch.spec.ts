import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.skip(!isLocalLane(), "seeds a full Scout workspace in the local preview database; never run against production");

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const stamp = "2026-10-01T00:00:00.000Z";
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    `ws-${suffix}`,
    "Full",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', 'on', ?)",
    `ent-self-${suffix}`,
    `ws-${suffix}`,
    `self-${suffix}.example`,
    stamp,
  );
  for (let index = 0; index < 6; index += 1) {
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, ?, ?, ?)",
      `ent-r${String(index)}-${suffix}`,
      `ws-${suffix}`,
      `rival${String(index)}-${suffix}.example`,
      index === 5 ? "Kindred" : `Rival ${String(index)}`,
      index === 5 ? "off" : "on",
      stamp,
    );
  }
  return `ent-r5-${suffix}`;
}

test("turning a paused rival on when the plan is full says why on the list and on its page", async ({ page }) => {
  const { cookie, seeded: pausedId } = await seedPreviewSession("plan-full", seed);
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/competitors");
  await page.getByRole("switch", { name: "Kindred tracking" }).click();
  const onList = page.locator('[data-slot="cap-refusal"]');
  await expect(onList).toContainText(
    "Your plan watches up to 5 competitors. Switch another one off to turn this one on.",
  );
  await expect(onList.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");
  await expect(page.getByRole("switch", { name: "Kindred tracking" })).not.toBeChecked();

  await page.goto(`/app/competitors/${pausedId}`);
  await page.getByRole("switch", { name: "Kindred tracking" }).click();
  await expect(page.locator('[data-slot="cap-refusal"]')).toContainText("Switch another one off to turn this one on.");
});
