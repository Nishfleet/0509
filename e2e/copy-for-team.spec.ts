import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { consoleFailures, isLocalLane, run, seedPreviewSession, watchConsole } from "./inbox";

test.skip(
  !isLocalLane(),
  "the site change is a row in the local preview database; production signs in through the magic-link inbox and has no fixture workspace",
);

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): string {
  const stamp = new Date(Date.now() - 3_600_000).toISOString();
  const workspaceId = `ws-${suffix}`;
  const entityId = `ent-z-${suffix}`;
  const url = `https://zephyr-${suffix}.example/pricing`;
  const payload = {
    page: { role: "pricing", url },
    before: { snapshotId: `snap-b-${suffix}`, screenshotKey: null },
    after: { snapshotId: `snap-a-${suffix}`, screenshotKey: null },
    diffKey: null,
    wordsAdded: 3,
    wordsRemoved: 2,
  };
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    workspaceId,
    "Copy For Team",
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
  run(
    db,
    `INSERT INTO signal (id, workspace_id, entity_id, source_id, kind, aspect, url, evidence_url, payload_json, dedup_key, observed_at, last_seen_at)
     VALUES (?, ?, ?, 'src_site_web', 'change', 'pricing', ?, ?, ?, ?, ?, ?)`,
    `sig-change-${suffix}`,
    workspaceId,
    entityId,
    url,
    url,
    JSON.stringify(payload),
    `dedup-change-${suffix}`,
    stamp,
    stamp,
  );
  return entityId;
}

test("a site change copies as one plain paragraph, by keyboard, with a toast and no overflow", async ({
  page,
  baseURL,
}, testInfo) => {
  const watched = watchConsole(page);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL ?? "" });
  const { cookie } = await seedPreviewSession("copy-for-team", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );

  await page.goto("/app/alerts");
  const button = page.getByTestId("copy-change");
  await expect(button).toHaveText("Copy for the team");
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(button).toHaveText("Copied");
  await expect(page.getByText("Copied for the team", { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^Zephyrwear .*\(pricing page\)\. Seen .+, via Five to Nine\.$/);
  expect(copied).not.toContain("\n");
  await expect(button).toHaveText("Copy for the team");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});

test("pointing at a capture plate loads the before-and-after dialog before the click", async ({ page, baseURL }) => {
  const { cookie } = await seedPreviewSession("plate-preload", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );

  await page.goto("/app/alerts");
  const plate = page.getByRole("button", { name: /^Open before and after: / });
  const chunk = page.waitForRequest((request) => request.url().includes("capture-dialog"));
  await plate.hover();
  await chunk;
  await plate.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
