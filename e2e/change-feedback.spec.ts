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
    "Change Feedback",
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

test("a customer answers Was this worth telling you by keyboard, changes the answer, and nothing shifts", async ({
  page,
  baseURL,
}, testInfo) => {
  const watched = watchConsole(page);
  await page.emulateMedia({ colorScheme: "dark" });
  const { cookie } = await seedPreviewSession("change-feedback", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );

  await page.goto("/app/alerts");
  const form = page.getByTestId("change-feedback");
  const yes = form.getByRole("button", { name: "Yes" });
  const no = form.getByRole("button", { name: "No" });
  await expect(form).toContainText("Was this worth telling you?");
  await expect(yes).toHaveAttribute("aria-pressed", "false");
  const before = await page.getByTestId("site-change").boundingBox();

  await yes.focus();
  await expect(yes).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/app\/alerts#sig-change-/);
  await expect(form).toContainText("Thanks, noted.");
  await expect(yes).toHaveAttribute("aria-pressed", "true");
  await expect(no).toHaveAttribute("aria-pressed", "false");
  const after = await page.getByTestId("site-change").boundingBox();
  expect(after?.height).toBe(before?.height);

  await no.focus();
  await page.keyboard.press("Enter");
  await expect(no).toHaveAttribute("aria-pressed", "true");
  await expect(yes).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("change-feedback")).toHaveCount(1);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
});
