import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.skip(
  !isLocalLane(),
  "seeds a workspace with an unreadable rival in the local preview database; never run against production",
);

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const stamp = "2026-10-12T00:00:00.000Z";
  const rivalId = `ent-rival-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    `ws-${suffix}`,
    "Trouble",
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
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, 'Walled Rival', 'on', ?)",
    rivalId,
    `ws-${suffix}`,
    `rival-${suffix}.example`,
    stamp,
  );
  run(
    db,
    "INSERT INTO page (id, entity_id, url, role, discovered_at, deferred_at) VALUES (?, ?, ?, 'home', ?, ?)",
    `page-${suffix}`,
    rivalId,
    `https://rival-${suffix}.example/`,
    stamp,
    stamp,
  );
  return rivalId;
}

test("a rival site that blocks us says what to do next", async ({ page }) => {
  const { cookie, seeded: rivalId } = await seedPreviewSession("trouble", seed);
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto(`/app/competitors/${rivalId}`);
  const note = page.locator('[data-slot="site-unreadable"]');
  await expect(note).toContainText("We couldn't read their website.");
  await expect(note).toContainText("add it under Another website of theirs below");
  await expect(page.getByRole("heading", { name: "Another website of theirs" })).toBeVisible();
  await expect(page.getByText("Watching from today.")).toHaveCount(0);
  await expect(page.getByText("First read tonight")).toHaveCount(0);
  await expect(page.getByText("our first read is tonight")).toHaveCount(0);
  await expect(page.getByText("We couldn't read their website, so there is nothing to score yet.")).toBeVisible();
});

test("Home does not say it is still reading a site we cannot read", async ({ page }) => {
  const { cookie } = await seedPreviewSession("trouble-home", seed);
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app");
  await expect(page.getByText("We couldn't read their website. We keep trying.")).toBeVisible();
  await expect(page.getByText("Reading its site now")).toHaveCount(0);
});

test("Alerts says how to reach a person", async ({ page }) => {
  const { cookie } = await seedPreviewSession("trouble-alerts", seed);
  await page.setExtraHTTPHeaders({ cookie });

  await page.goto("/app/alerts");
  const help = page.getByTestId("alerts-help");
  await expect(help).toContainText("Think an alert is wrong, or one is missing?");
  await expect(help.getByRole("link", { name: "support@0509.io" })).toHaveAttribute("href", "mailto:support@0509.io");
});
