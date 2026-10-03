import { describe, expect, it } from "vitest";

import {
  alertsResultSchema,
  briefResultSchema,
  competitorArgsSchema,
  competitorResultSchema,
  competitorsResultSchema,
  standingResultSchema,
} from "../app/lib/agent/schemas";

const observedAt = "2026-09-20T00:00:00.000Z";

const competitor = {
  id: "acme",
  name: "Acme",
  domain: "acme.com",
  reason: null,
};

const trackedCompetitor = {
  id: "acme",
  name: "Acme",
  domain: "acme.com",
  state: "on",
  stateChangedAt: "2026-09-01T00:00:00.000Z",
  pagesWatched: 6,
  lastCheckedAt: null,
  changesThisWeek: 2,
  changes: [
    {
      id: "change-1",
      headline: "New pricing page",
      page: "https://acme.com/pricing",
      url: "https://acme.com/pricing",
      observedAt,
      summary: "Prices moved from $9 to $12",
    },
  ],
};

const standingLine = {
  competitorId: "acme",
  name: "Acme",
  rank: 3,
  movement: -1,
  isNew: false,
  biggestMove: null,
  newAds: 2,
  newMentions: 5,
  siteChanges: 1,
};

const validBrief = {
  periodStart: "2026-09-14T00:00:00.000Z",
  periodEnd: "2026-09-21T00:00:00.000Z",
  timezone: "Asia/Kolkata",
  headline: {
    rank: 4,
    of: 12,
    movement: 1,
    isNew: false,
    why: "Two mentions moved you up",
  },
  quietWeek: false,
  readThisFirst: [
    {
      competitor: "acme",
      title: "New pricing page",
      source: "acme.com",
      observedAt,
      url: "https://acme.com/pricing",
      before: "$9",
      after: "$12",
      why: "They undercut us on every tier",
    },
  ],
  standing: [standingLine],
  ownSite: {
    status: "ok",
    incidents: [],
  },
  checked: {
    mentions: 8,
    siteChanges: 2,
    newAds: 4,
    sourcesDown: [],
  },
  nextBriefAt: "2026-09-28T00:00:00.000Z",
};

const validStanding = {
  rank: 4,
  of: 12,
  movement: 1,
  isNew: false,
  why: "Two mentions moved you up",
  lines: [standingLine],
};

const validAlert = {
  id: "alert-1",
  kind: "mention",
  title: "A new mention",
  body: null,
  createdAt: observedAt,
};

describe("competitorArgsSchema", () => {
  it("accepts a non-empty competitor id", () => {
    expect(competitorArgsSchema.safeParse({ competitorId: "abc" }).success).toBe(true);
  });

  it("rejects an empty competitor id", () => {
    expect(competitorArgsSchema.safeParse({ competitorId: "" }).success).toBe(false);
  });

  it("rejects a missing competitor id", () => {
    expect(competitorArgsSchema.safeParse({}).success).toBe(false);
  });
});

describe("competitorsResultSchema", () => {
  it("accepts empty tracked and suggested lists", () => {
    expect(competitorsResultSchema.safeParse({ tracked: [], suggested: [] }).success).toBe(true);
  });

  it("accepts a tracked and a suggested competitor", () => {
    const result = competitorsResultSchema.safeParse({
      tracked: [competitor],
      suggested: [{ ...competitor, id: "beta", name: "Beta", domain: "beta.com", reason: "Same buyer" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a competitor with no domain", () => {
    const result = competitorsResultSchema.safeParse({
      tracked: [{ id: "acme", name: "Acme", reason: null }],
      suggested: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a null reason", () => {
    const result = competitorsResultSchema.safeParse({
      tracked: [{ ...competitor, reason: null }],
      suggested: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("competitorResultSchema", () => {
  it("accepts a null competitor", () => {
    expect(competitorResultSchema.safeParse({ competitor: null }).success).toBe(true);
  });

  it("accepts a competitor with changes", () => {
    expect(competitorResultSchema.safeParse({ competitor: trackedCompetitor }).success).toBe(true);
  });

  it("rejects a competitor whose state is paused", () => {
    const result = competitorResultSchema.safeParse({
      competitor: { ...trackedCompetitor, state: "paused" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a competitor with no domain", () => {
    const result = competitorResultSchema.safeParse({
      competitor: {
        id: "acme",
        name: "Acme",
        state: "on",
        stateChangedAt: "2026-09-01T00:00:00.000Z",
        pagesWatched: 6,
        lastCheckedAt: null,
        changesThisWeek: 2,
        changes: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("alertsResultSchema", () => {
  it.each(["delivery_failed", "takedown", "site_change", "mention"])("accepts an alert of kind %s", (kind) => {
    expect(alertsResultSchema.safeParse({ alerts: [{ ...validAlert, kind }] }).success).toBe(true);
  });

  it("rejects an unknown alert kind", () => {
    const result = alertsResultSchema.safeParse({ alerts: [{ ...validAlert, kind: "other" }] });
    expect(result.success).toBe(false);
  });

  it("accepts a null alert body", () => {
    expect(alertsResultSchema.safeParse({ alerts: [{ ...validAlert, body: null }] }).success).toBe(true);
  });

  it("rejects an alert with no title", () => {
    const result = alertsResultSchema.safeParse({
      alerts: [{ id: "alert-1", kind: "mention", body: null, createdAt: observedAt }],
    });
    expect(result.success).toBe(false);
  });
});

describe("briefResultSchema", () => {
  it("accepts a null brief", () => {
    expect(briefResultSchema.safeParse({ brief: null }).success).toBe(true);
  });

  it("accepts a full brief", () => {
    expect(briefResultSchema.safeParse({ brief: validBrief }).success).toBe(true);
  });

  it("rejects a brief whose quietWeek is not a boolean", () => {
    const result = briefResultSchema.safeParse({ brief: { ...validBrief, quietWeek: "yes" } });
    expect(result.success).toBe(false);
  });

  it("rejects a brief whose ownSite status is not ok or broken", () => {
    const result = briefResultSchema.safeParse({
      brief: { ...validBrief, ownSite: { status: "down", incidents: [] } },
    });
    expect(result.success).toBe(false);
  });
});

describe("standingResultSchema", () => {
  it("accepts a null standing", () => {
    expect(standingResultSchema.safeParse({ standing: null }).success).toBe(true);
  });

  it("accepts a standing result with lines", () => {
    expect(standingResultSchema.safeParse({ standing: validStanding }).success).toBe(true);
  });

  it("rejects a standing result whose why is not a string", () => {
    const result = standingResultSchema.safeParse({ standing: { ...validStanding, why: 4 } });
    expect(result.success).toBe(false);
  });

  it("rejects a standing result with no lines", () => {
    const result = standingResultSchema.safeParse({
      standing: { rank: 4, of: 12, movement: 1, isNew: false, why: "Two mentions moved you up" },
    });
    expect(result.success).toBe(false);
  });
});
