import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { readDeliveryFailures, readTakedownNotes } from "../../../app/lib/data/alert.server";

const NOW = "2026-09-25T00:00:00Z";
const USER = "user-alert-row";
const WORKSPACE = "ws-alert-row";
const KIND = "delivery_failed";
const TAKEDOWN = "takedown";
const TITLE = "Digest not delivered";
const BODY = "Provider said 500";

const cleanTables = ["alert", "digest", "incident_notice", "incident", "page", "entity", "workspace"];

describe("alert row readers (0509#7144)", () => {
  beforeEach(async () => {
    for (const table of cleanTables) {
      await env.DB.exec(`DELETE FROM ${table}`);
    }
    await env.DB.exec('DELETE FROM "user"');
    await env.DB.prepare(
      `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt)
       VALUES (?, 'Owner', ?, 1, ?, ?)`,
    )
      .bind(USER, "alert-row@0509.io", NOW, NOW)
      .run();
    await env.DB.prepare(
      `INSERT INTO workspace (id, name, owner_user_id, timezone, brief_weekday, brief_hour, created_at)
       VALUES (?, 'Alert rows', ?, 'UTC', 1, 8, ?)`,
    )
      .bind(WORKSPACE, USER, NOW)
      .run();
  });

  const insertAlert = async (id: string, kind: string, title: string, body: string | null) => {
    await env.DB.prepare(
      `INSERT INTO alert (id, workspace_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, WORKSPACE, kind, title, body, NOW)
      .run();
  };

  it("readDeliveryFailures maps one delivery failure with no linked digest", async () => {
    await insertAlert("dlvy-a", KIND, TITLE, BODY);

    const rows = await readDeliveryFailures(env.DB, WORKSPACE);

    expect(rows).toEqual([
      {
        id: "dlvy-a",
        title: TITLE,
        body: BODY,
        created_at: NOW,
        digest_id: null,
        brief: null,
      },
    ]);
  });

  it("readDeliveryFailures keeps a null body as null", async () => {
    await insertAlert("dlvy-b", KIND, TITLE, null);

    const rows = await readDeliveryFailures(env.DB, WORKSPACE);

    expect(rows).toEqual([
      {
        id: "dlvy-b",
        title: TITLE,
        body: null,
        created_at: NOW,
        digest_id: null,
        brief: null,
      },
    ]);
  });

  it("readTakedownNotes returns id, title and created_at", async () => {
    await insertAlert("tkdn-a", TAKEDOWN, "Page taken down", null);

    const notes = await readTakedownNotes(env.DB, WORKSPACE);

    expect(notes).toEqual([{ id: "tkdn-a", title: "Page taken down", created_at: NOW }]);
  });

  it("readTakedownNotes ignores alerts of other kinds", async () => {
    await insertAlert("dlvy-c", KIND, "Not a takedown", null);

    expect(await readTakedownNotes(env.DB, WORKSPACE)).toEqual([]);
  });
});
