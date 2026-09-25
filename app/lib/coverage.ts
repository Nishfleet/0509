import type { PlanId } from "./billing/plans";

interface CoverageSource {
  id: string;
  label: string;
  live: boolean;
  sourceKey?: string;
  plan?: Exclude<PlanId, "scout">;
  instant?: boolean;
}

interface CoverageKind {
  kind: string;
  noun?: string;
  origin?: string;
  sources: readonly CoverageSource[];
}

export const PLAN_NOTE = { starter: "Starter and up", agency: "Agency" } as const;

export const COVERAGE = [
  {
    kind: "Ads",
    noun: "ads",
    origin: "the ad libraries platforms publish",
    sources: [
      { id: "ads.meta", label: "Meta", live: false },
      { id: "ads.google", label: "Google", live: false },
      { id: "ads.tiktok", label: "TikTok", live: false },
      { id: "ads.linkedin", label: "LinkedIn", live: false, plan: "starter" },
      { id: "ads.reddit", label: "Reddit", live: false },
    ],
  },
  {
    kind: "Site changes",
    noun: "website changes",
    origin: "public web pages",
    sources: [
      { id: "site.home", label: "Homepage", live: true, sourceKey: "site.web" },
      { id: "site.pricing", label: "Pricing page", live: false },
      { id: "site.all", label: "Every page we find", live: false, plan: "starter" },
    ],
  },
  {
    kind: "Mentions",
    noun: "news mentions",
    origin: "news and public posts",
    sources: [
      { id: "mentions.news", label: "News", live: true, sourceKey: "gdelt.doc" },
      { id: "mentions.hn", label: "Hacker News", live: true, sourceKey: "hn.algolia" },
      { id: "mentions.reddit", label: "Reddit", live: false },
      { id: "mentions.medium", label: "Medium", live: false },
      { id: "mentions.youtube", label: "YouTube", live: true, sourceKey: "youtube.channel_rss" },
    ],
  },
  {
    kind: "Hiring",
    noun: "hiring",
    origin: "public job boards",
    sources: [{ id: "hiring.boards", label: "Public job boards", live: false }],
  },
  {
    kind: "Your own site",
    sources: [{ id: "own.breakage", label: "Breakage alerts", live: true, plan: "starter", instant: true }],
  },
] as const satisfies readonly CoverageKind[];

export type CoverageId = (typeof COVERAGE)[number]["sources"][number]["id"];

export const LIVE_COVERAGE: readonly CoverageKind[] = COVERAGE.flatMap((group: CoverageKind) => {
  const sources = group.sources.filter((source) => source.live);
  return sources.length === 0 ? [] : [{ ...group, sources }];
});

const LIVE_IDS: ReadonlySet<string> = new Set(LIVE_COVERAGE.flatMap((group) => group.sources.map((source) => source.id)));

export function isLive(id: CoverageId): boolean {
  return LIVE_IDS.has(id);
}

export function joinList(items: readonly string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1) ?? ""}`;
}

export const WATCHED_NOUNS = joinList(LIVE_COVERAGE.flatMap((group) => group.noun ?? []));

export const WATCHED_ORIGINS = joinList(LIVE_COVERAGE.flatMap((group) => group.origin ?? []));

export const FEATURES: readonly string[] = LIVE_COVERAGE.flatMap((group) =>
  group.sources.map((source) => `${group.kind}: ${source.label}`),
);
