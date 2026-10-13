import { expect, test } from "./test";

import { isLocalLane, readPreview, run, seedPreviewSession } from "./inbox";

test.skip(!isLocalLane(), "production covers deletion in j14-delete-workspace.spec.ts with a real inbox");

test("an account deleted from settings lands on the deleted page, signs out and leaves no rows behind", async ({
  page,
  baseURL,
}) => {
  const { cookie, seeded } = await seedPreviewSession("delete", ({ db, suffix, userId }) => {
    const stamp = "2026-10-12T00:00:00.000Z";
    run(
      db,
      "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
      `ws-${suffix}`,
      "Delete Preview",
      userId,
      stamp,
    );
    run(
      db,
      "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Delete Brand', ?)",
      `ent-self-${suffix}`,
      `ws-${suffix}`,
      `delete-${suffix}.example`,
      stamp,
    );
    return { userId, workspaceId: `ws-${suffix}` };
  });
  const email = readPreview(
    (db) => (db.prepare('SELECT email FROM "user" WHERE id = ?').get(seeded.userId) as { email: string }).email,
  );
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );

  await page.goto("/app/settings");
  await expect(page.getByRole("heading", { name: "Delete your account" })).toBeVisible();
  await page.getByLabel(`Type ${email} to confirm`).fill(email);
  await page.getByRole("button", { name: "Delete my account" }).click();

  await page.waitForURL(/\/login\?deleted=/);
  await expect(page.getByRole("heading", { name: "Your account is deleted" })).toBeVisible();

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  const left = readPreview((db) => ({
    users: (db.prepare('SELECT COUNT(*) AS n FROM "user" WHERE id = ?').get(seeded.userId) as { n: number }).n,
    workspaces: (
      db.prepare("SELECT COUNT(*) AS n FROM workspace WHERE id = ?").get(seeded.workspaceId) as { n: number }
    ).n,
    entities: (
      db.prepare("SELECT COUNT(*) AS n FROM entity WHERE workspace_id = ?").get(seeded.workspaceId) as {
        n: number;
      }
    ).n,
  }));
  expect(left).toEqual({ users: 0, workspaces: 0, entities: 0 });
});
