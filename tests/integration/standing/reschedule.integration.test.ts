import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { BriefSchedule } from "../../../app/lib/brief-schedule";
import { nextBriefAt, rolloverInstance } from "../../../app/lib/brief-schedule";
import { rescheduleRollover } from "../../../app/lib/standing/reschedule";

/**
 * The reschedule path against real workerd and the real Workflows binding
 * (0509#5161). No D1 rows are needed: a sleeping instance never reads the
 * database, which is what makes a terminate-then-create observable here.
 */

function scheduleOffsetFromToday(days: number, hour: number): BriefSchedule {
  return { timezone: "UTC", weekday: (new Date().getUTCDay() + days) % 7, hour };
}

function workspace(): string {
  return `ws_reschedule_${crypto.randomUUID()}`;
}

const LIVE = ["queued", "running", "waiting"];

describe("rescheduleRollover against the real Workflows binding (0509#5161)", () => {
  it("terminates the sleeping instance and creates the new one", async () => {
    const ws = workspace();
    const now = new Date();
    const previous = scheduleOffsetFromToday(2, 8);
    const next = scheduleOffsetFromToday(3, 9);

    const stale = rolloverInstance(ws, nextBriefAt(previous, now), "scheduled");
    await env.STANDING_ROLLOVER.create(stale);

    const result = await rescheduleRollover(env.STANDING_ROLLOVER, { workspaceId: ws, previous, next, now });

    const fresh = rolloverInstance(ws, nextBriefAt(next, now), "scheduled");
    expect(result).toEqual({ cancelledId: stale.id, createdId: fresh.id });

    await expect
      .poll(async () => (await (await env.STANDING_ROLLOVER.get(stale.id)).status()).status, { timeout: 20_000 })
      .toBe("terminated");
    expect(LIVE).toContain((await (await env.STANDING_ROLLOVER.get(fresh.id)).status()).status);
  });

  it("creates the new instance when no stale one exists", async () => {
    const ws = workspace();
    const now = new Date();
    const previous = scheduleOffsetFromToday(2, 8);
    const next = scheduleOffsetFromToday(3, 9);

    const result = await rescheduleRollover(env.STANDING_ROLLOVER, { workspaceId: ws, previous, next, now });

    const fresh = rolloverInstance(ws, nextBriefAt(next, now), "scheduled");
    expect(result).toEqual({ cancelledId: null, createdId: fresh.id });
    expect(LIVE).toContain((await (await env.STANDING_ROLLOVER.get(fresh.id)).status()).status);
  });

  it("an unchanged time touches nothing", async () => {
    const ws = workspace();
    const now = new Date();
    const previous = scheduleOffsetFromToday(2, 8);

    const result = await rescheduleRollover(env.STANDING_ROLLOVER, {
      workspaceId: ws,
      previous,
      next: previous,
      now,
    });

    expect(result).toEqual({ cancelledId: null, createdId: null });
  });
});
