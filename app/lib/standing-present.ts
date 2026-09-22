export interface RankedBrand {
  entityId: string;
  rank: number;
}

export interface SourceHealth {
  name: string;
  canary: number | null;
  lastFetchedAt: string | null;
}

export interface WeekScore {
  entityId: string;
  name: string;
  weekStartAt: string;
  score: number;
}

export function formatScore(score: number): string {
  return score === 0 ? "—" : String(score);
}

export function formatMovement(movement: number | null): string {
  if (movement === null) return "new";
  if (movement > 0) return `+${String(movement)}`;
  return String(movement);
}

export function quietWeekLine(mentions: number, siteChanges: number, newAds: number): string {
  const ads = newAds === 0 ? "no new ads" : `${String(newAds)} new ads`;
  return `Quiet week: ${String(mentions)} mentions checked, ${String(siteChanges)} site changes, ${ads}.`;
}

export function suppressQuietWeek(sources: SourceHealth[]): boolean {
  return sources.some((source) => source.canary === 0);
}

export function briefDisagrees(digestRanks: RankedBrand[], standing: RankedBrand[]): boolean {
  if (digestRanks.length === 0) return false;
  const standingById = new Map(standing.map((row) => [row.entityId, row.rank]));
  return digestRanks.some((row) => standingById.get(row.entityId) !== row.rank);
}

export interface HomeBrand {
  entityId: string;
  name: string;
  rankLabel: string;
  movement: string;
  scoreLabel: string;
}

export interface HomeRead {
  signalId: string;
  title: string;
  evidenceUrl: string | null;
  reason: string | null;
}

export interface HomePanel {
  phase: "empty" | "gathering" | "ranked";
  message: string | null;
  arrival: string | null;
  brands: HomeBrand[];
  weeks: string[];
  series: { entityId: string; name: string; scores: (number | null)[] }[];
  why: string | null;
  whyIsJev: boolean;
  updatedSinceBrief: boolean;
  readFirst: HomeRead[];
  freshness: { name: string; line: string }[];
  paused: string[];
}

export function fourWeekSeries(points: WeekScore[]): {
  weeks: string[];
  series: { entityId: string; name: string; scores: (number | null)[] }[];
} {
  const weeks = [...new Set(points.map((point) => point.weekStartAt))].sort();
  const names = new Map<string, string>();
  for (const point of points) names.set(point.entityId, point.name);
  const series = [...names.entries()].map(([entityId, name]) => ({
    entityId,
    name,
    scores: weeks.map((week) => {
      const found = points.find((point) => point.entityId === entityId && point.weekStartAt === week);
      return found ? found.score : null;
    }),
  }));
  return { weeks, series };
}
