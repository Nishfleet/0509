import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import {
  readOwnSiteAlerts,
  readWorkspaceIdForOwner,
  setOwnSiteAlerts,
} from "../../app/lib/data/workspace.server";

const OWNER = "user-own-site-alerts";
const WORKSPACE = "ws-own-site-alerts";

const storedColumn = async (): Promise<number | undefined> =>
  (
    await env.DB.prepare("SELECT own_site_alerts AS v FROM workspace WHERE id = ?")
      .bind(WORKSPACE)
      .first<{ v: number }>()
  )?.v;

describe("workspace own-site alerts setting (0509#4764)", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM workspace").run();
    await env.DB.prepare('DELETE FROM "user"').run();
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', 'owner@0509.io', 1, '2026-09-24T00:00:00Z', '2026-09-24T00:00:00Z')`,
    )
      .bind(OWNER)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Own-site alerts', ?, 'UTC', 1, 8, '2026-09-24T00:00:00Z')`,
    )
      .bind(WORKSPACE, OWNER)
      .run();
  });

  it("defaults to on for a fresh workspace, and reads on for an unknown one", async () => {
    expect(await readWorkspaceIdForOwner(OWNER)).toBe(WORKSPACE);
    expect(await readOwnSiteAlerts(WORKSPACE)).toBe(true);
    expect(await storedColumn()).toBe(1);
    expect(await readOwnSiteAlerts("missing-workspace")).toBe(true);
  });

  it("turns off, stays off when set off again, and stores the column as 0", async () => {
    await setOwnSiteAlerts(WORKSPACE, false);
    expect(await readOwnSiteAlerts(WORKSPACE)).toBe(false);
    expect(await storedColumn()).toBe(0);

    await setOwnSiteAlerts(WORKSPACE, false);
    expect(await readOwnSiteAlerts(WORKSPACE)).toBe(false);
  });

  it("turns back on and stores the column as 1", async () => {
    await setOwnSiteAlerts(WORKSPACE, false);
    await setOwnSiteAlerts(WORKSPACE, true);
    expect(await readOwnSiteAlerts(WORKSPACE)).toBe(true);
    expect(await storedColumn()).toBe(1);
  });
});
