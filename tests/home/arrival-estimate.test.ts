import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FirstFilePanel } from "../../app/components/first-file-panel";
import { firstSiteSweepAt } from "../../app/lib/onboarding/arrival-estimate";
import type { BriefSchedule } from "../../app/lib/brief-schedule";
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
  it("lands the sweep on the next 02:00Z when a site source is enabled", () => {
    expect(firstSiteSweepAt({ now: new Date("2026-09-24T01:00:00Z"), sources: SITE_SOURCES })).toEqual(
      new Date("2026-09-24T02:00:00Z"),
    );
    expect(firstSiteSweepAt({ now: new Date("2026-09-24T02:00:00Z"), sources: SITE_SOURCES })).toEqual(
      new Date("2026-09-25T02:00:00Z"),
    );
  });

  it("has no sweep to point at when only mentions are enabled", () => {
    expect(firstSiteSweepAt({ now: new Date("2026-09-24T01:00:00Z"), sources: MENTION_SOURCES })).toBeNull();
  });
});

describe("homeView gathering standing", () => {
  it("reports no first sweep when no site source is enabled", () => {
    const view = homeView({
      payload: null,
      entities: TWO_ON,
      schedule: SCHEDULE,
      history: [],
      sources: [],
      now: new Date("2026-09-24T06:30:00.000Z"),
    });
    expect(view.standing.kind).toBe("gathering");
    if (view.standing.kind !== "gathering") return;
    expect(view.standing.firstSweepAt).toBeNull();
    expect(view.standing.briefAt).toBe("Monday 08:00");
  });
});

describe("FirstFilePanel", () => {
  it("says what is being gathered and never says soon when no sweep is scheduled", () => {
    const html = renderToStaticMarkup(
      createElement(FirstFilePanel, { brands: 2, firstSweepAt: null, briefAt: "Monday 08:00" }),
    );
    expect(html).toContain("as soon as the first sweep is scheduled");
    expect(html).not.toContain("soon,");
    expect(html).not.toContain("soon.");
  });
});
