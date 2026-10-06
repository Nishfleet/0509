import { describe, expect, it, vi } from "vitest";

import type { BriefSchedule } from "../../app/lib/brief-schedule";
import { pendingRolloverIds, retireRollovers } from "../../app/lib/standing/retire";

const WS = "ws_retire";
const NOW = new Date("2026-09-22T12:00:00Z");
const SCHEDULE: BriefSchedule = { timezone: "UTC", weekday: 1, hour: 8 };

describe("retiring a deleted workspace's standing rollovers (0509#7191)", () => {
  it("names the next scheduled instance and the last week's scheduled and catch-up instances", () => {
    expect(pendingRolloverIds(WS, SCHEDULE, NOW)).toEqual([
      "rollover-ws_retire-20260928T0800",
      "rollover-ws_retire-20260921T0800",
      "rollover-ws_retire-20260921T0800-catch-up",
    ]);
  });

  it("terminates each instance it finds and reports only the ones it terminated", async () => {
    const terminate = vi.fn(() => Promise.resolve());
    const get = vi.fn((id: string) =>
      id.endsWith("catch-up")
        ? Promise.reject(new Error("instance.not_found"))
        : Promise.resolve({
            terminate: id.includes("20260921") ? () => Promise.reject(new Error("already complete")) : terminate,
          }),
    );

    const terminated = await retireRollovers({ get }, { workspaceId: WS, schedule: SCHEDULE }, NOW);

    expect(get).toHaveBeenCalledTimes(3);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(terminated).toEqual(["rollover-ws_retire-20260928T0800"]);
  });
});
