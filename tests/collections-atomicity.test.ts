import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createCollectionWithinLimit, renameCollection } from "~/lib/data/collections.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

describe("collection plan-cap atomicity (sqlite)", () => {
  let harness: ReturnType<typeof createSqliteD1>;
  let env: Parameters<typeof createCollectionWithinLimit>[0];

  beforeEach(() => {
    harness = createSqliteD1();
    applyMigration(harness.sqlite, "migrations/0000_auth.sql");
    applyMigration(harness.sqlite, "migrations/0001_app.sql");
    harness.sqlite
      .prepare(
        `
          INSERT INTO user (id, name, email, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?)
        `,
      )
      .run("user-1", "Owner", "owner@example.com", "2026-07-15", "2026-07-15");
    env = { DB: harness.db } as Parameters<typeof createCollectionWithinLimit>[0];
  });

  afterEach(() => {
    harness.close();
  });

  it("accepts exactly one of two logically racing requests for the final slot", async () => {
    await createCollectionWithinLimit(env, "user-1", { name: "Existing" }, 3);
    await createCollectionWithinLimit(env, "user-1", { name: "Existing 2" }, 3);

    const outcomes = await Promise.all([
      createCollectionWithinLimit(env, "user-1", { name: "Race A" }, 3),
      createCollectionWithinLimit(env, "user-1", { name: "Race B" }, 3),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "created")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "over_cap")).toEqual([
      {
        status: "over_cap",
        collection: null,
        current: 3,
        limit: 3,
      },
    ]);
    expect(
      harness.sqlite.prepare("SELECT COUNT(*) AS count FROM collection WHERE user_id = ?").get("user-1"),
    ).toEqual({ count: 3 });
  });

  it("renames a collection the user owns and bumps updated_at", async () => {
    const created = await createCollectionWithinLimit(env, "user-1", { name: "Old name" }, 3);
    expect(created.status).toBe("created");
    const collectionId = created.collection!.id;

    const renamed = await renameCollection(env, "user-1", collectionId, "  New name  ");

    expect(renamed).not.toBeNull();
    expect(renamed!.name).toBe("New name");
    expect(renamed!.updatedAt).toBeTruthy();
    expect(
      harness.sqlite.prepare("SELECT name FROM collection WHERE id = ?").get(collectionId),
    ).toEqual({ name: "New name" });
  });

  it("refuses to rename a collection owned by another user", async () => {
    const created = await createCollectionWithinLimit(env, "user-1", { name: "Mine" }, 3);
    expect(created.status).toBe("created");
    const collectionId = created.collection!.id;

    const renamed = await renameCollection(env, "user-2", collectionId, "Theirs");

    expect(renamed).toBeNull();
    expect(
      harness.sqlite.prepare("SELECT name FROM collection WHERE id = ?").get(collectionId),
    ).toEqual({ name: "Mine" });
  });
});
