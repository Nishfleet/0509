import { experimental_readRawConfig } from "wrangler";
import { describe, expect, it } from "vitest";

import {
  FEED_SWEEP_CRON,
  HIRING_SWEEP_CRON,
  isDiscoveryDay,
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

/**
 * One cron constant feeds two parsers that disagree about the numbers.
 * Cloudflare counts days of the week 1 = Sunday .. 7 = Saturday (its docs:
 * "1-7, case-insensitive 3-letter abbreviations"); Sentry's cronsim counts
 * 0 = Sunday .. 6 = Saturday, where SYMBOLIC_DAYS is "SUN MON TUE WED THU FRI
 * SAT", so its 1 is Monday. `triggers.crons` runs the Worker, and
 * `cronMonitor()` hands the same string to the Sentry Cron Monitor, so
 * `0 4 * * 1` started the refresh on Sunday and left Sentry waiting for the
 * check-in on the Monday it had computed, which raised a missed-check-in
 * alert every week while the job had already run (0509#7067). Both parsers
 * take the abbreviation, so no constant here carries a numeric weekday.
 */
const CRON_CONSTANTS: Record<string, string> = {
  MENTIONS_SWEEP_CRON,
  SITE_SWEEP_CRON,
  OWN_SITE_CHECK_CRON,
  NIGHTLY_CRON,
  WEEKLY_REFRESH_CRON,
  HIRING_SWEEP_CRON,
  FEED_SWEEP_CRON,
  SNAPSHOT_BACKUP_CRON,
};

function dayOfWeekField(cron: string): string {
  return cron.trim().split(/\s+/).at(-1) ?? "";
}

describe("cron weekday fields", () => {
  it.each(Object.entries(CRON_CONSTANTS))("%s spells its weekday out instead of numbering it", (name, cron) => {
    const fields = cron.trim().split(/\s+/);
    expect(fields, `${name} = ${JSON.stringify(cron)} is not a five-field cron.`).toHaveLength(5);
    const weekday = dayOfWeekField(cron);
    expect(
      weekday === "*" || !/\d/.test(weekday),
      `${name} = ${JSON.stringify(cron)} numbers its day of week. Cloudflare reads 1 as Sunday and Sentry reads it as Monday; write it out (MON, not 1).`,
    ).toBe(true);
  });

  it("leaves every wrangler trigger free of a numbered weekday", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const crons = rawConfig.triggers?.crons ?? [];
    expect(crons).toEqual(expect.arrayContaining([...Object.values(CRON_CONSTANTS), "*/5 * * * *"]));
    const numbered = crons.filter((cron) => /\d/.test(dayOfWeekField(cron)));
    expect(numbered, `wrangler.jsonc numbers the day of week in: ${numbered.join(", ")}`).toEqual([]);
  });
});

describe("isDiscoveryDay", () => {
  it("is true on the weekday the workspace was created and false on the other six", () => {
    const createdAt = "2026-09-14T22:30:00.000Z";
    const week = Array.from({ length: 7 }, (_, offset) => new Date(Date.UTC(2026, 8, 21 + offset, 3)));
    expect(week.filter((day) => isDiscoveryDay(createdAt, day)).map((day) => day.toISOString().slice(0, 10))).toEqual([
      "2026-09-21",
    ]);
  });
});
