import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "@playwright/test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(
  !isLocalLane(),
  "the preview Worker signs in through a seeded session; production reads the kept accounts in competitor-page.spec.ts",
);

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const stamp = "2026-10-12T00:00:00.000Z";
  const workspaceId = `ws-${suffix}`;
  const entityId = `ent-z-${suffix}`;
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Competitor Preview",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    workspaceId,
    `self-${suffix}.example`,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'competitor', ?, 'Zephyrwear', ?)",
    entityId,
    workspaceId,
    `zephyr-${suffix}.example`,
    stamp,
  );
  return entityId;
}

test("a watched competitor page leads with its biggest move slab and a switch that turns off without a dialog", async ({
  page,
  baseURL,
}, testInfo) => {
  const watched = watchConsole(page);
  const { cookie, seeded } = await seedPreviewSession("competitor", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );

  await page.goto(`/app/competitors/${seeded}`);
  const slab = page.locator("[data-section='biggest-move']");
  await expect(slab).toBeVisible();
  await expect(slab.getByText(/^Nothing worth scoring for this competitor in the last 7 days\./)).toBeVisible();
  const box = await slab.boundingBox();
  expect(box?.y ?? Infinity).toBeLessThan(900);

  await expect(page.getByText("Turn off to stop watching and alerts.", { exact: false })).toBeVisible();
  const toggle = page.getByRole("switch", { name: / tracking (ON|OFF)$/ });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("[data-slot='competitor-paused']")).toContainText("Paused");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("switch", { name: / tracking (ON|OFF)$/ })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("switch", { name: / tracking (ON|OFF)$/ }).click();
  await expect(page.getByRole("switch", { name: / tracking (ON|OFF)$/ })).toHaveAttribute("aria-checked", "true");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
