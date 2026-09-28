import { z } from "zod";

const isoTime = z.string().meta({ description: "ISO 8601 timestamp" });

const changeSchema = z
  .object({
    competitor: z.string(),
    title: z.string(),
    source: z.string(),
    observedAt: isoTime,
    url: z.string(),
    before: z.string().nullable(),
    after: z.string().nullable(),
    why: z.string().meta({ description: "Why this change matters to you" }),
  })
  .meta({ id: "Change" });

const standingLineSchema = z
  .object({
    competitorId: z.string(),
    name: z.string(),
    rank: z.number().nullable(),
    movement: z.number().nullable().meta({ description: "Places gained since last week; negative is a drop" }),
    isNew: z.boolean(),
    biggestMove: z.string().nullable(),
    newAds: z.number(),
    newMentions: z.number(),
    siteChanges: z.number(),
  })
  .meta({ id: "StandingLine" });

const briefSchema = z
  .object({
    periodStart: isoTime,
    periodEnd: isoTime,
    timezone: z.string(),
    headline: z.object({
      rank: z.number().nullable(),
      of: z.number(),
      movement: z.number().nullable(),
      isNew: z.boolean(),
      why: z.string(),
    }),
    quietWeek: z.boolean(),
    readThisFirst: z.array(changeSchema),
    standing: z.array(standingLineSchema),
    ownSite: z.object({
      status: z.enum(["ok", "broken"]),
      incidents: z.array(
        z.object({ pageUrl: z.string(), kind: z.string(), observedAt: isoTime, open: z.boolean() }),
      ),
    }),
    checked: z.object({
      mentions: z.number(),
      siteChanges: z.number(),
      newAds: z.number(),
      sourcesDown: z.array(z.object({ name: z.string(), lastLandedAt: isoTime.nullable() })),
    }),
    nextBriefAt: isoTime.nullable(),
  })
  .meta({ id: "Brief" });

export const briefResultSchema = z
  .object({ brief: briefSchema.nullable().meta({ description: "Null until your first weekly brief is ready" }) });

export const standingResultSchema = z.object({
  standing: z
    .object({
      rank: z.number().nullable(),
      of: z.number(),
      movement: z.number().nullable(),
      isNew: z.boolean(),
      why: z.string(),
      lines: z.array(standingLineSchema),
    })
    .nullable(),
});

const competitorSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    domain: z.string(),
    reason: z.string().nullable(),
  })
  .meta({ id: "Competitor" });

export const competitorsResultSchema = z
  .object({
    tracked: z.array(competitorSchema),
    suggested: z.array(competitorSchema).meta({ description: "Brands we think compete with you, waiting for your yes" }),
  });

export const competitorArgsSchema = z.object({
  competitorId: z.string().min(1).meta({ description: "A competitor id from list_competitors" }),
});

export const competitorResultSchema = z.object({
  competitor: z
    .object({
      id: z.string(),
      name: z.string(),
      domain: z.string(),
      state: z.enum(["on", "off"]),
      stateChangedAt: isoTime.nullable(),
      pagesWatched: z.number(),
      lastCheckedAt: isoTime.nullable(),
      changesThisWeek: z.number(),
      changes: z.array(
        z.object({
          id: z.string(),
          headline: z.string(),
          page: z.string(),
          url: z.string(),
          observedAt: isoTime,
          summary: z.string(),
        }),
      ),
    })
    .nullable(),
});

const alertSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["delivery_failed", "takedown", "site_change"]),
    title: z.string(),
    body: z.string().nullable(),
    createdAt: isoTime,
  })
  .meta({ id: "Alert" });

export const alertsResultSchema = z.object({ alerts: z.array(alertSchema) });

export type BriefResult = z.output<typeof briefResultSchema>;
export type CompetitorsResult = z.output<typeof competitorsResultSchema>;
export type CompetitorResult = z.output<typeof competitorResultSchema>;
export type AlertsResult = z.output<typeof alertsResultSchema>;
export type StandingResult = z.output<typeof standingResultSchema>;
