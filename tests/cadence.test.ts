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
  siteSweepLabel,
  SWEEP_MONITORS,
  WEEKLY_REFRESH_CRON,
  sweepMonitor,
} from "../app/lib/cadence";

const MINUTES_IN_DAY = 24 * 60;

function cronMinuteOfDay(cron: string): number {
  const [minute = "0", hour = "0"] = cron.trim().split(/\s+/);
  return Number(hour) * 60 + Number(minute);
}

/**
 * Minutes from a sweep's start to the next nightly refresh. The overnight
 * block wraps midnight (19:00 to 03:00), so the difference is taken modulo a
 * day rather than as a plain subtraction.
 */
function minutesToNightly(cron: string): number {
  return (cronMinuteOfDay(NIGHTLY_CRON) - cronMinuteOfDay(cron) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
}

// 0509#5823: the schedule constants live in app/lib/cadence.ts. The
// Workflow schedule and the trigger crons below are asserted against the
// constants, never against a literal, so the gate reddens the day one of them
// diverges from the constant it names.
describe("cadence", () => {
  it("leaves the six scheduled Workflows off `schedules` and starts them from triggers.crons", () => {
    const { rawConfig } = experimental_readRawConfig({ config: "wrangler.jsonc" });
    const daily = ["site-sweep", "mentions-sweep", "hiring-sweep", "feed-sweep", "snapshot-backup", "own-site-check"];
    const workflows = (rawConfig.workflows ?? []) as { name: string; schedules?: unknown }[];
    const scheduled = workflows.filter((workflow) => daily.includes(workflow.name));
    expect(scheduled).toHaveLength(6);
    expect(scheduled.map((workflow) => workflow.schedules)).toEqual([
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
    expect(SITE_SWEEP_CRON).toBe(`0 ${String(SITE_SWEEP_UTC_HOUR).padStart(2, "0")} * * *`);
    expect(SITE_SWEEP_UTC_LABEL).toBe(`${String(SITE_SWEEP_UTC_HOUR).padStart(2, "0")}:00 UTC`);
  });

  it("names the sweep clock in the workspace zone, not as a UTC-only label", () => {
    const now = new Date("2026-10-05T12:00:00.000Z");
    expect(siteSweepLabel("UTC", now)).toBe(SITE_SWEEP_UTC_LABEL);
    expect(siteSweepLabel("Asia/Kolkata", now)).toMatch(/^02:30 /);
    expect(siteSweepLabel("Asia/Kolkata", now)).not.toContain("UTC");
  });
});

/**
 * 0509#7191: the site sweep ran from 02:00 UTC with a 120 minute budget and the
 * nightly refresh starts at 03:00, so at 40 to 50 workspaces the sweep was
 * still writing when the refresh wanted to write. Every sweep now starts early
 * enough to finish before NIGHTLY_CRON, and the Workflows build their monitor
 * from SWEEP_MONITORS, so a cron and the budget that watches it live in one
 * place. These two assertions are the gate: a cron moved back to 02:00, or a
 * budget raised past the nightly, reddens here instead of the nightly.
 */
describe("nightly sweeps finish before the nightly refresh", () => {
  it("starts and finishes every sweep before NIGHTLY_CRON", () => {
    for (const [cron, monitor] of Object.entries(SWEEP_MONITORS)) {
      const runway = minutesToNightly(cron);
      expect(
        monitor.maxRuntime,
        `${monitor.slug} starts at ${cron} and can run ${String(monitor.maxRuntime)} minutes, past the ${NIGHTLY_CRON} nightly refresh ${String(runway)} minutes later.`,
      ).toBeLessThanOrEqual(runway);
    }
  });

  it("watches each sweep with its own cron, so a monitor cannot drift off the schedule it watches", () => {
    for (const cron of [MENTIONS_SWEEP_CRON, SITE_SWEEP_CRON, HIRING_SWEEP_CRON, FEED_SWEEP_CRON]) {
      const monitor = SWEEP_MONITORS[cron];
      expect(sweepMonitor(cron)).toEqual({
        schedule: { type: "crontab", value: cron },
        checkinMargin: monitor?.checkinMargin,
        maxRuntime: monitor?.maxRuntime,
      });
    }
    expect(() => sweepMonitor(NIGHTLY_CRON)).toThrow(/No sweep monitor for cron/);
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
    const crons: string[] = rawConfig.triggers?.crons ?? [];
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
