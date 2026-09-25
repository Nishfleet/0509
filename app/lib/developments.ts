export const FEED_KINDS = ["ad", "change", "mention", "hiring"] as const;

export type FeedKind = (typeof FEED_KINDS)[number];

export type FeedFilter = "all" | FeedKind;

export const FEED_PARAM = "kind";

export const FEED_FILTERS: readonly { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "ad", label: "Ads" },
  { value: "change", label: "Site changes" },
  { value: "mention", label: "Mentions" },
  { value: "hiring", label: "Hiring" },
];

export const SOURCE_LABEL: Readonly<Record<FeedKind, string>> = {
  ad: "Ad library",
  change: "Website",
  mention: "Mention",
  hiring: "Careers page",
};

export interface DevelopmentItem {
  id: string;
  kind: FeedKind;
  title: string | null;
  summary: string | null;
  url: string | null;
  observedAt: string;
}

export function isFeedKind(value: string): value is FeedKind {
  return FEED_KINDS.some((kind) => kind === value);
}

export function parseFeedFilter(value: string | null): FeedFilter {
  if (value !== null && isFeedKind(value)) return value;
  return "all";
}

export function filterFeed<T extends { kind: FeedKind }>(
  items: readonly T[],
  filter: FeedFilter,
): T[] {
  if (filter === "all") return items.slice();
  return items.filter((item) => item.kind === filter);
}

export function countByKind(
  items: readonly { kind: FeedKind }[],
): Record<FeedFilter, number> {
  const totals: Record<FeedFilter, number> = { all: items.length, ad: 0, change: 0, mention: 0, hiring: 0 };
  return items.reduce((counts, item) => {
    const next: Record<FeedFilter, number> = { ...counts, [item.kind]: counts[item.kind] + 1 };
    return next;
  }, totals);
}
