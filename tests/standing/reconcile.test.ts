import { describe, expect, it } from "vitest";

import { createCatchUp, replaceRollover, type RolloverParams } from "../../app/lib/standing-schedule.server";
import { needsCatchUp } from "../../workers/standing/score";

const clock = { id: "ws-1", timezone: "UTC", briefWeekday: 1, briefHour: 8 };

function binding(open = false) {
  const created: { id: string; params: RolloverParams }[] = [];
  const terminated: string[] = [];
  return {
    created,
    terminated,
    api: {
      async get(id: string) {
        if (!open) throw new Error("missing");
        return {
          id,
          async status() {
            return { status: "waiting" };
          },
          async terminate() {
            terminated.push(id);
          },
        };
      },
      async create(options: { id: string; params: RolloverParams }) {
        created.push(options);
        return {
          id: options.id,
          async status() {
            return { status: "queued" };
          },
          async terminate() {
            terminated.push(options.id);
          },
        };
      },
    },
  };
}

function db() {
  const writes: (string | number | null)[][] = [];
  return {
    writes,
    api: {
      prepare() {
        return {
          bind(...values: (string | number | null)[]) {
            return {
              async run() {
                writes.push(values);
              },
              async first() {
                return null;
              },
            };
          },
        };
      },
    },
  };
}

describe("standing reconciliation", () => {
  it("creates a catch-up when the latest week is missing and records the instant", async () => {
    const now = new Date("2026-09-22T03:00:00.000Z");
    const current = "2026-09-21T08:00:00.000Z";
    expect(needsCatchUp(null, current)).toBe(true);
    const roll = binding();
    const store = db();
    const id = await createCatchUp(roll.api, store.api, clock, null, now);
    expect(id).toBeTruthy();
    expect(roll.created).toHaveLength(1);
    expect(roll.created[0]?.params.workspaceId).toBe("ws-1");
    expect(roll.created[0]?.params.runAt).toBe(now.toISOString());
    expect(roll.created[0]?.params.closeWeekStart).toBe("2026-09-14T08:00:00.000Z");
    expect(store.writes[0]?.[0]).toBe(now.toISOString());
    expect(store.writes[0]?.[1]).toBe(id);
  });

  it("does not enqueue a second catch-up while one is still waiting", async () => {
    const roll = binding(true);
    const store = db();
    const id = await createCatchUp(
      roll.api,
      store.api,
      clock,
      "standing_ws_1_1",
      new Date("2026-09-22T03:00:00.000Z"),
    );
    expect(id).toBeNull();
    expect(roll.created).toHaveLength(0);
  });

  it("cancels the sleeping instance when the brief time changes", async () => {
    const roll = binding(true);
    const store = db();
    const id = await replaceRollover(roll.api, store.api, clock, "standing_old", new Date("2026-09-22T03:00:00.000Z"));
    expect(roll.terminated).toEqual(["standing_old"]);
    expect(id).not.toBe("standing_old");
    expect(roll.created[0]?.params.runAt).toBe("2026-09-28T08:00:00.000Z");
  });
});
