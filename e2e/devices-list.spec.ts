import type { DatabaseSync } from "node:sqlite";

import { expect, test } from "./test";

import { isLocalLane, run, seedPreviewSession } from "./inbox";

test.skip(!isLocalLane(), "seeds extra sessions for a preview account; production keeps one real session per account");

const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

function addSession(db: DatabaseSync, userId: string, id: string, agent: string | null, touched: string, ends: string) {
  run(
    db,
    'INSERT INTO "session" (id, "expiresAt", token, "createdAt", "updatedAt", "userAgent", "userId") VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    ends,
    `token-${id}`,
    touched,
    touched,
    agent,
    userId,
  );
}

function seed({ db, suffix, userId }: { db: DatabaseSync; suffix: string; userId: string }): void {
  const stamp = "2026-10-12T00:00:00.000Z";
  run(
    db,
    "INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at) VALUES (?, ?, ?, 'UTC', 1, 8, ?)",
    `ws-${suffix}`,
    "Devices Preview",
    userId,
    stamp,
  );
  run(
    db,
    "INSERT INTO entity (id, workspace_id, role, domain, name, created_at) VALUES (?, ?, 'self', ?, 'Self Brand', ?)",
    `ent-self-${suffix}`,
    `ws-${suffix}`,
    `self-${suffix}.example`,
    stamp,
  );
  const open = "2099-01-01T00:00:00.000Z";
  addSession(db, userId, `dev-fox-${suffix}`, FIREFOX, "2026-10-11T09:00:00.000Z", open);
  addSession(db, userId, `dev-none-${suffix}`, null, "2026-10-10T09:00:00.000Z", open);
  addSession(db, userId, `dev-old-${suffix}`, SAFARI, "2026-09-01T09:00:00.000Z", "2026-09-02T00:00:00.000Z");
}

test("Settings names each device by browser and system, dates the others, and hides ended sessions", async ({
  page,
  baseURL,
}) => {
  const { cookie } = await seedPreviewSession("devices", seed);
  await page.context().addCookies(
    cookie.split("; ").map((pair) => {
      const [name, ...value] = pair.split("=");
      return { name, value: value.join("="), url: baseURL ?? "" };
    }),
  );
  await page.goto("/app/settings");

  const list = page.getByRole("list", { name: "Where you're signed in" });
  await expect(list).toBeVisible();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list.getByRole("listitem").filter({ hasText: "This device" })).toHaveCount(1);
  const firefox = list.getByRole("listitem").filter({ hasText: "Firefox on Windows" });
  await expect(firefox).toContainText(/Last active.*11/);
  const unknown = list.getByRole("listitem").filter({ hasText: "Unknown device", hasNotText: "This device" });
  await expect(unknown).toContainText(/Last active.*10/);
  await expect(list.getByText("iPhone")).toHaveCount(0);
});
