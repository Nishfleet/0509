import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(!isLocalLane(), "the preview Worker signs in through a seeded session; production has no fixture workspace");

const STAMP = "2026-10-12T00:00:00.000Z";

function seedGathering({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): void {
  const workspaceId = `ws-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "First Look",
    userId,
    STAMP,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    workspaceId,
    `self-${suffix}.example`,
    STAMP,
  );
  for (const name of ["Zephyrwear", "Northloop"]) {
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, state, created_at) VALUES (?, ?, 'competitor', ?, ?, 'on', ?)",
      `ent-${name}-${suffix}`,
      workspaceId,
      `${name.toLowerCase()}-${suffix}.example`,
      name,
      STAMP,
    );
  }
}

test("before the first brief Home lists where each rival stands", async ({ page, baseURL }, testInfo) => {
  const { cookie } = await seedPreviewSession("first-look", seedGathering);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
  const watched = watchConsole(page);

  await page.goto("/app");
  const firstLook = page.locator('[data-home="first-look"]');
  await expect(firstLook.getByRole("heading", { name: "Where your competitors stand today" })).toBeVisible();
  await expect(firstLook.getByRole("listitem")).toHaveCount(2);
  await expect(firstLook).toContainText("Zephyrwear");
  await expect(firstLook).toContainText("Northloop");
  await expect(firstLook.getByText("First read tonight")).toHaveCount(2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
