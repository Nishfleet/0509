import { describe, expect, it } from "vitest";

import {
  instantStamp,
  nextBriefAt,
  openWeek,
  previousBriefAt,
  weekClosingAt,
  type BriefSchedule,
} from "../../app/lib/brief-schedule";

const MONDAY_8_UTC: BriefSchedule = { timezone: "UTC", weekday: 1, hour: 8 };
const MONDAY_8_NEW_YORK: BriefSchedule = { timezone: "America/New_York", weekday: 1, hour: 8 };
const SUNDAY_2_LONDON: BriefSchedule = { timezone: "Europe/London", weekday: 0, hour: 2 };
const MONDAY_8_KOLKATA: BriefSchedule = { timezone: "Asia/Kolkata", weekday: 1, hour: 8 };

const at = (iso: string) => new Date(iso);

describe("the brief schedule (0509#4004)", () => {
  it("finds the next Monday 08:00 in the workspace's zone", () => {
    expect(nextBriefAt(MONDAY_8_UTC, at("2026-09-24T03:00:00.000Z")).toISOString()).toBe("2026-09-28T08:00:00.000Z");
    expect(nextBriefAt(MONDAY_8_NEW_YORK, at("2026-09-24T03:00:00.000Z")).toISOString()).toBe(
      "2026-09-28T12:00:00.000Z",
    );
    expect(nextBriefAt(MONDAY_8_KOLKATA, at("2026-09-24T03:00:00.000Z")).toISOString()).toBe(
      "2026-09-28T02:30:00.000Z",
    );
  });

  it("treats the brief instant itself as the start of the next week", () => {
    const monday = at("2026-09-28T08:00:00.000Z");
    expect(nextBriefAt(MONDAY_8_UTC, monday).toISOString()).toBe("2026-10-05T08:00:00.000Z");
    expect(previousBriefAt(MONDAY_8_UTC, monday).toISOString()).toBe("2026-09-21T08:00:00.000Z");
    expect(openWeek(MONDAY_8_UTC, monday)).toEqual({
      startsAt: monday,
      closesAt: at("2026-10-05T08:00:00.000Z"),
    });
  });

  it("keeps the local hour across a daylight-saving change", () => {
    const beforeFallBack = at("2026-10-30T12:00:00.000Z");
    const week = openWeek(MONDAY_8_NEW_YORK, beforeFallBack);
    expect(week.startsAt.toISOString()).toBe("2026-10-26T12:00:00.000Z");
    expect(week.closesAt.toISOString()).toBe("2026-11-02T13:00:00.000Z");
    expect(week.closesAt.getTime() - week.startsAt.getTime()).toBe(169 * 60 * 60 * 1000);
  });

  it("never skips a week when the brief hour does not exist that day", () => {
    const springForward = nextBriefAt(SUNDAY_2_LONDON, at("2026-03-26T00:00:00.000Z"));
    const following = nextBriefAt(SUNDAY_2_LONDON, springForward);
    expect(springForward.toISOString().slice(0, 10)).toBe("2026-03-29");
    expect(following.toISOString().slice(0, 10)).toBe("2026-04-05");
  });

  it("keeps the week after a DST-gap hour, instead of an hour-long skip", () => {
    const londonOne: BriefSchedule = { timezone: "Europe/London", weekday: 0, hour: 1 };
    const gapInstant = nextBriefAt(londonOne, at("2026-03-26T00:00:00.000Z"));
    const weekAfter = openWeek(londonOne, gapInstant);
    expect(gapInstant.toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(weekAfter.startsAt.toISOString()).toBe(gapInstant.toISOString());
    expect(weekAfter.closesAt.toISOString()).toBe("2026-04-05T00:00:00.000Z");
    expect(weekAfter.closesAt.getTime() - weekAfter.startsAt.getTime()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  it("keeps both neighbouring weeks for a 45-minute offset around its DST gap", () => {
    const chathamThree: BriefSchedule = { timezone: "Pacific/Chatham", weekday: 0, hour: 3 };
    const beforeGap = nextBriefAt(chathamThree, at("2026-09-13T00:00:00.000Z"));
    const gapInstant = nextBriefAt(chathamThree, beforeGap);
    const weekAfter = openWeek(chathamThree, gapInstant);
    const following = nextBriefAt(chathamThree, weekAfter.closesAt);
    expect(gapInstant.toISOString()).toBe("2026-09-26T14:15:00.000Z");
    expect(weekAfter.startsAt.toISOString()).toBe(gapInstant.toISOString());
    expect(weekAfter.closesAt.toISOString()).toBe("2026-10-03T13:15:00.000Z");
    expect(following.toISOString()).toBe("2026-10-10T13:15:00.000Z");
    expect(weekAfter.closesAt.getTime() - weekAfter.startsAt.getTime()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  it("uses the first valid local hour when the brief hour is inside a spring-forward gap", () => {
    const newYorkTwo: BriefSchedule = { timezone: "America/New_York", weekday: 0, hour: 2 };
    const gapInstant = nextBriefAt(newYorkTwo, at("2026-03-01T12:00:00.000Z"));
    const weekAfter = openWeek(newYorkTwo, gapInstant);
    expect(gapInstant.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(weekAfter.startsAt.toISOString()).toBe(gapInstant.toISOString());
    expect(weekAfter.closesAt.toISOString()).toBe("2026-03-15T06:00:00.000Z");
    expect(weekAfter.closesAt.getTime() - weekAfter.startsAt.getTime()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
  });

  it("names the week that closes at an instant", () => {
    const closesAt = at("2026-09-28T08:00:00.000Z");
    expect(weekClosingAt(MONDAY_8_UTC, closesAt)).toEqual({
      startsAt: at("2026-09-21T08:00:00.000Z"),
      closesAt,
    });
  });

  it("stamps an instant for a Workflow instance id", () => {
    expect(instantStamp(at("2026-09-28T08:00:00.000Z"))).toBe("20260928T0800");
    expect(instantStamp(at("2026-09-28T02:30:00.000Z"))).toMatch(/^[0-9A-Z]+$/);
  });
});
