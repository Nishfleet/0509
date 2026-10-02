import { experimental_readRawConfig } from "wrangler";
import { describe, expect, it } from "vitest";

import {
  FEED_SWEEP_CRON,
  HIRING_SWEEP_CRON,
  MENTIONS_SWEEP_CRON,
  NIGHTLY_CRON,
  OWN_SITE_CHECK_CRON,
  SITE_SWEEP_CRON,
  SITE_SWEEP_UTC_HOUR,
  SNAPSHOT_BACKUP_CRON,
  SITE_SWEEP_UTC_LABEL,
  WEEKLY_REFRESH_CRON,
} from "../app/lib/cadence";

// 0509#5823: the schedule constants live in app/lib/cadence.ts. The
// Workflow schedule and the trigger crons below are asserted against the
// constants, never against a literal, so the gate reddens the day one of them
// diverges from the constant it names.
describe("cadence", () => {
  it("leaves the six scheduled Workflows off `schedules` and starts them from triggers.crons", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const daily = ["site-sweep", "mentions-sweep", "hiring-sweep", "feed-sweep", "snapshot-backup", "own-site-check"];
    const workflows = (rawConfig.workflows ?? []).filter((workflow) => daily.includes(workflow.name));
    expect(workflows).toHaveLength(6);
    expect(workflows.map((workflow) => workflow.schedules)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(rawConfig.triggers?.crons).toEqual(
      expect.arrayContaining([
        SITE_SWEEP_CRON,
        MENTIONS_SWEEP_CRON,
        HIRING_SWEEP_CRON,
        FEED_SWEEP_CRON,
        SNAPSHOT_BACKUP_CRON,
        OWN_SITE_CHECK_CRON,
      ]),
    );
  });

  it("triggers NIGHTLY_CRON and WEEKLY_REFRESH_CRON", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    expect(rawConfig.triggers?.crons).toContain(NIGHTLY_CRON);
    expect(rawConfig.triggers?.crons).toContain(WEEKLY_REFRESH_CRON);
  });

  it("pins the site-sweep cron and label to the UTC hour the sweep runs at", () => {
    expect(SITE_SWEEP_CRON).toBe(`0 ${SITE_SWEEP_UTC_HOUR} * * *`);
    expect(SITE_SWEEP_UTC_LABEL).toBe(`${String(SITE_SWEEP_UTC_HOUR).padStart(2, "0")}:00 UTC`);
  });
});
