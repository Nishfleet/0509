import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FirstFilePanel } from "../../app/components/first-file-panel";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
import { firstSiteSweepAt } from "../../app/lib/onboarding/arrival-estimate";
import { arrivalAround } from "../../app/lib/home-standing";
import type { HomeEntity, HomeSource } from "../../app/lib/home-standing";
import { homeView } from "../../app/lib/home-standing";

const SCHEDULE: BriefSchedule = { timezone: "Europe/London", weekday: 1, hour: 8 };

const SITE_SOURCES: readonly HomeSource[] = [{ key: "site", kind: "site", platform: "site" }];
const MENTION_SOURCES: readonly HomeSource[] = [{ key: "reddit.search_rss", kind: "mentions", platform: "reddit" }];

const TWO_ON: readonly HomeEntity[] = [
  { id: "ent_self", role: "self", domain: "own.example", name: "Own Brand", state: "on" },
  { id: "ent_kindred", role: "competitor", domain: "kindred.example", name: "Kindred", state: "on" },
];

describe("firstSiteSweepAt", () => {
  it("lands the arrival after the next 02:00Z sweep has had time to finish", () => {
    expect(firstSiteSweepAt({ now: new Date("2026-09-24T01:00:00Z"), sources: SITE_SOURCES, brandsOn: 0 })).toEqual(
      new Date("2026-09-24T06:00:00Z"),
    );
    expect(firstSiteSweepAt({ now: new Date("2026-09-24T02:00:00Z"), sources: SITE_SOURCES, brandsOn: 0 })).toEqual(
      new Date("2026-09-25T06:00:00Z"),
    );
  });

  it("promises the next sweep as soon as a brand is on, before its site source is seeded", () => {
    expect(firstSiteSweepAt({ now: new Date("2026-09-24T01:00:00Z"), sources: [], brandsOn: 2 })).toEqual(
      new Date("2026-09-24T06:00:00Z"),
    );
  });

  it("has no sweep to point at when only mentions are enabled and no brand is on", () => {
    expect(
      firstSiteSweepAt({ now: new Date("2026-09-24T01:00:00Z"), sources: MENTION_SOURCES, brandsOn: 0 }),
    ).toBeNull();
  });
});

describe("arrivalAround", () => {
  it("names the weekday, date and the UTC label", () => {
    expect(arrivalAround("UTC", new Date("2026-10-03T06:00:00Z"))).toBe("Saturday 3 October, around 06:00 UTC");
  });

  it("renders in a non-UTC workspace timezone with its own label and date", () => {
    expect(arrivalAround("Europe/London", new Date("2026-10-03T06:00:00Z"))).toBe(
      "Saturday 3 October, around 07:00 BST",
    );
    expect(arrivalAround("America/New_York", new Date("2026-10-03T03:00:00Z"))).toBe(
      "Friday 2 October, around 23:00 GMT-4",
    );
  });
});

describe("homeView gathering standing", () => {
  it("names the next daily sweep even before a site source exists, once a brand is on", () => {
    const view = homeView({
      payload: null,
      entities: TWO_ON,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      counts: [],
      moves: [],
      now: new Date("2026-09-24T06:30:00.000Z"),
    });
    expect(view.standing.kind).toBe("gathering");
    if (view.standing.kind !== "gathering") return;
    expect(view.standing.firstSweepAt).toBe("Friday 25 September, around 07:00 BST");
    expect(view.standing.briefAt).toBe("Monday 08:00");
  });
});

describe("FirstFilePanel", () => {
  it("promises a dated arrival with a timezone label", () => {
    const html = renderToStaticMarkup(
      createElement(FirstFilePanel, {
        brands: 2,
        firstSweepAt: "Saturday 3 October, around 06:00 UTC",
        briefAt: "Monday 08:00",
      }),
    );
    expect(html).toContain("Your first site snapshots arrive on Saturday 3 October, around 06:00 UTC.");
  });

  it("says what is being gathered and never says soon when no sweep is scheduled", () => {
    const html = renderToStaticMarkup(
      createElement(FirstFilePanel, { brands: 2, firstSweepAt: null, briefAt: "Monday 08:00" }),
    );
    expect(html).toContain("once the first check is scheduled");
    expect(html).not.toContain("soon,");
    expect(html).not.toContain("soon.");
  });
});
