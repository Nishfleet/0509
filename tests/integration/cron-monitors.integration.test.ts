import { describe, expect, it } from "vitest";

import { WEEKLY_REFRESH_CRON } from "../../app/lib/discovery/start.server";
import { cronMonitor } from "../../workers/cron-monitors";
import { NIGHTLY_CRON } from "../../workers/delivery/sweeper";

/**
 * Every scheduled cron's Sentry Cron Monitor (0509#5750, parent 0509#5736).
 *
 * This file lives in the workers project because workers/cron-monitors.ts
 * imports app/lib/discovery/start.server.ts, which imports cloudflare:workers.
 */

describe("cronMonitor", () => {
  it("maps the nightly cron to a 60-minute check-in margin and a 30-minute run budget", () => {
    expect(NIGHTLY_CRON).toBe("0 3 * * *");
    expect(cronMonitor(NIGHTLY_CRON)).toEqual({
      slug: "nightly",
      schedule: "0 3 * * *",
      checkinMargin: 60,
      maxRuntime: 30,
    });
  });

  it("maps the weekly refresh cron to a 60-minute check-in margin and a 30-minute run budget", () => {
    expect(WEEKLY_REFRESH_CRON).toBe("0 4 * * 1");
    expect(cronMonitor(WEEKLY_REFRESH_CRON)).toEqual({
      slug: "weekly-refresh",
      schedule: "0 4 * * 1",
      checkinMargin: 60,
      maxRuntime: 30,
    });
  });

  it("maps the liveness cron to a 10-minute check-in margin and a 1-minute run budget", () => {
    expect(cronMonitor("*/5 * * * *")).toEqual({
      slug: "liveness-ping",
      schedule: "*/5 * * * *",
      checkinMargin: 10,
      maxRuntime: 1,
    });
  });

  it("returns undefined for a cron with no monitor", () => {
    expect(cronMonitor("0 0 * * *")).toBeUndefined();
  });

  it("gives the three monitors distinct slugs", () => {
    const slugs = [NIGHTLY_CRON, WEEKLY_REFRESH_CRON, "*/5 * * * *"].map((cron) => cronMonitor(cron)?.slug);
    expect(slugs).toEqual(["nightly", "weekly-refresh", "liveness-ping"]);
    expect(new Set(slugs).size).toBe(3);
  });
});
