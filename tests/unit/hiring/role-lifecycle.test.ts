import { describe, expect, it } from "vitest";

import {
  planRoleLifecycle,
  readLifecycle,
  type HiringSignalState,
  type HiringSignalUpdate,
  type Lifecycle,
} from "../../../app/lib/hiring/role-lifecycle";

const TICK = "2026-09-24T12:00:00.000Z";

const EARLIER_TICK = "2026-09-23T12:00:00.000Z";

const FIRST_CLOSED_AT = "2026-09-20T12:00:00.000Z";

const OPEN: Lifecycle = { state: "open", missed: 0, closedAt: null, reopenedAt: null, reopenCount: 0 };

function row(
  id: string,
  roleId: string,
  payload: Record<string, unknown>,
  lastSeenAt: string | null = EARLIER_TICK,
): HiringSignalState {
  return { id, roleId, lastSeenAt, payloadJson: JSON.stringify(payload) };
}

function payloadOf(update: HiringSignalUpdate): Record<string, unknown> {
  return JSON.parse(update.payloadJson) as Record<string, unknown>;
}

function lifecycleOf(update: HiringSignalUpdate): unknown {
  return payloadOf(update).lifecycle;
}

describe("readLifecycle", () => {
  it("reads a valid lifecycle out of the payload object", () => {
    const lifecycle: Lifecycle = { state: "closed", missed: 0, closedAt: FIRST_CLOSED_AT, reopenedAt: TICK, reopenCount: 2 };

    expect(readLifecycle(JSON.stringify({ platform: "greenhouse", lifecycle }))).toEqual(lifecycle);
  });

  it("defaults a payload with no lifecycle key", () => {
    expect(readLifecycle(JSON.stringify({ platform: "lever" }))).toEqual(OPEN);
  });

  it("defaults a payload that is not JSON", () => {
    expect(readLifecycle("not json at all")).toEqual(OPEN);
  });

  it("defaults an invalid lifecycle", () => {
    expect(readLifecycle(JSON.stringify({ lifecycle: { state: "paused", missed: 2 } }))).toEqual(OPEN);
  });

  it("defaults a JSON body that is not an object", () => {
    expect(readLifecycle(JSON.stringify([1, 2, 3]))).toEqual(OPEN);
  });
});

describe("planRoleLifecycle", () => {
  it("advances last_seen_at and resets missed for a still-open role", () => {
    const rows = [row("s1", "r1", { lifecycle: { ...OPEN, missed: 1 } })];

    const updates = planRoleLifecycle(rows, ["r1"], TICK);

    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("s1");
    expect(updates[0].lastSeenAt).toBe(TICK);
    expect(lifecycleOf(updates[0])).toEqual(OPEN);
  });

  it("sets missed to 1 and keeps last_seen_at on the first absence", () => {
    const rows = [row("s1", "r1", { lifecycle: OPEN })];

    const updates = planRoleLifecycle(rows, [], TICK);

    expect(updates).toHaveLength(1);
    expect(updates[0].lastSeenAt).toBe(EARLIER_TICK);
    expect(lifecycleOf(updates[0])).toEqual({ ...OPEN, missed: 1 });
  });

  it("closes on the second consecutive absence", () => {
    const rows = [row("s1", "r1", { lifecycle: { ...OPEN, missed: 1 } })];

    const updates = planRoleLifecycle(rows, [], TICK);

    expect(updates).toHaveLength(1);
    expect(updates[0].lastSeenAt).toBe(EARLIER_TICK);
    expect(lifecycleOf(updates[0])).toEqual({ state: "closed", missed: 0, closedAt: TICK, reopenedAt: null, reopenCount: 0 });
  });

  it("reopens a closed role that reappears, keeping the last closure", () => {
    const rows = [
      row("s1", "r1", {
        lifecycle: { state: "closed", missed: 0, closedAt: FIRST_CLOSED_AT, reopenedAt: null, reopenCount: 0 },
      }),
    ];

    const updates = planRoleLifecycle(rows, ["r1"], TICK);

    expect(updates).toHaveLength(1);
    expect(updates[0].lastSeenAt).toBe(TICK);
    expect(lifecycleOf(updates[0])).toEqual({
      state: "open",
      missed: 0,
      closedAt: FIRST_CLOSED_AT,
      reopenedAt: TICK,
      reopenCount: 1,
    });
  });

  it("yields no update for a closed role that is absent", () => {
    const rows = [
      row("s1", "r1", {
        lifecycle: { state: "closed", missed: 0, closedAt: FIRST_CLOSED_AT, reopenedAt: null, reopenCount: 1 },
      }),
    ];

    expect(planRoleLifecycle(rows, [], TICK)).toEqual([]);
  });

  it("keeps an unrelated payload key alongside the new lifecycle", () => {
    const rows = [row("s1", "r1", { platform: "greenhouse", location: "Remote", team: "Design", lifecycle: OPEN })];

    const updates = planRoleLifecycle(rows, ["r1"], TICK);

    expect(payloadOf(updates[0])).toEqual({
      platform: "greenhouse",
      location: "Remote",
      team: "Design",
      lifecycle: OPEN,
    });
  });

  it("treats a non-JSON payload as the default lifecycle", () => {
    const broken: HiringSignalState = { id: "s1", roleId: "r1", lastSeenAt: EARLIER_TICK, payloadJson: "{" };

    const updates = planRoleLifecycle([broken], [], TICK);

    expect(updates).toHaveLength(1);
    expect(updates[0].lastSeenAt).toBe(EARLIER_TICK);
    expect(lifecycleOf(updates[0])).toEqual({ ...OPEN, missed: 1 });
  });

  it("ignores a present role that has no row", () => {
    expect(planRoleLifecycle([], ["r1", "r2"], TICK)).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const rows = [row("s1", "r1", { lifecycle: OPEN }), row("s2", "r2", { platform: "lever" })];
    const present = ["r1"];
    const rowsBefore = structuredClone(rows);
    const presentBefore = [...present];

    planRoleLifecycle(rows, present, TICK);

    expect(rows).toEqual(rowsBefore);
    expect(present).toEqual(presentBefore);
  });
});
