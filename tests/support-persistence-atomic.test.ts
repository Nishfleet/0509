import { describe, expect, it } from "vitest";

import {
  createSupportCase,
  createSupportCaseEvent,
  listSupportCaseEvents,
  listSupportCases,
} from "~/lib/data/support.server";
import { applyMigration, createSqliteD1 } from "./helpers/sqlite-d1";

function migrateSupport(sqlite: ReturnType<typeof createSqliteD1>, includeEvents = true) {
  sqlite.sqlite.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY NOT NULL);
    CREATE TABLE delivery_attempt (
      idempotency_key TEXT,
      payload_snapshot_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
  applyMigration(sqlite.sqlite, "migrations/0039_support_cases.sql");
  applyMigration(sqlite.sqlite, "migrations/0041_support_case_request_key.sql");
  if (includeEvents) {
    applyMigration(sqlite.sqlite, "migrations/0061_support_case_events.sql");
  }
  sqlite.sqlite.exec("INSERT INTO user (id) VALUES ('user-1');");
}

describe("support case atomic persistence", () => {
  it("rolls back the case when its opening audit event cannot persist", async () => {
    const sqlite = createSqliteD1();
    try {
      migrateSupport(sqlite, false);

      await expect(createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "delivery",
        subject: "Digest missing",
        detail: "The weekly digest did not arrive.",
        requestKey: "support-atomic-failure",
      })).rejects.toThrow();

      await expect(listSupportCases({ DB: sqlite.db } as never, "user-1")).resolves.toEqual([]);
    } finally {
      sqlite.close();
    }
  });

  it("persists one case and one opening event for repeated identical requests", async () => {
    const sqlite = createSqliteD1();
    try {
      migrateSupport(sqlite);
      const input = {
        userId: "user-1",
        category: "delivery",
        subject: "Digest missing",
        detail: "The weekly digest did not arrive.",
        requestKey: "support-concurrent-request",
      } as const;

      const first = await createSupportCase({ DB: sqlite.db } as never, input);
      const second = await createSupportCase({ DB: sqlite.db } as never, input);

      expect(first?.id).toBe(second?.id);
      expect([first?.alreadyExists, second?.alreadyExists].sort()).toEqual([false, true]);
      const cases = await listSupportCases({ DB: sqlite.db } as never, "user-1");
      expect(cases).toHaveLength(1);
      const events = await listSupportCaseEvents(
        { DB: sqlite.db } as never,
        "user-1",
        cases[0].id,
      );
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe("case_opened");
    } finally {
      sqlite.close();
    }
  });

  it("persists one notification outcome per idempotency key", async () => {
    const sqlite = createSqliteD1();
    try {
      migrateSupport(sqlite);
      const supportCase = await createSupportCase({ DB: sqlite.db } as never, {
        userId: "user-1",
        category: "delivery",
        subject: "Digest missing",
        detail: "The weekly digest did not arrive.",
        requestKey: "support-notification-outcome",
      });
      expect(supportCase).not.toBeNull();

      const input = {
        caseId: supportCase!.id,
        userId: "user-1",
        eventType: "support_notified",
        message: "Support was notified by email.",
        idempotencyKey: `support-notification:${supportCase!.id}:sent`,
        metadata: { channel: "email" },
      } as const;
      const first = await createSupportCaseEvent({ DB: sqlite.db } as never, input);
      const second = await createSupportCaseEvent({ DB: sqlite.db } as never, input);

      expect(first?.id).toBe(second?.id);
      const events = await listSupportCaseEvents(
        { DB: sqlite.db } as never,
        "user-1",
        supportCase!.id,
      );
      expect(events.filter((event) => event.eventType === "support_notified")).toHaveLength(1);
      expect(events.find((event) => event.eventType === "support_notified")?.metadata).toMatchObject({
        channel: "email",
        idempotencyKey: `support-notification:${supportCase!.id}:sent`,
      });
    } finally {
      sqlite.close();
    }
  });
});
