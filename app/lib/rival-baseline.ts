import { countPhrase } from "./quiet-week";

export const BASELINE_DAYS = 30;

export interface BaselineKind {
  kind: string;
  count: number;
  latestTitle: string | null;
  latestAt: string;
}

export interface FeedFacts {
  posts: number;
  latestTitle: string | null;
  latestAt: string | null;
}

export interface RivalFacts {
  description: string | null;
  pages: number;
  reads: number;
  firstReadAt: string | null;
  changes: number;
  lastChangeAt: string | null;
  roles: readonly string[];
  kinds: readonly BaselineKind[];
  feed: FeedFacts | null;
}

const MAX_DESCRIPTION = 140;
const MAX_TITLE = 80;

const ROLE_LABELS: ReadonlyMap<string, string> = new Map([
  ["pricing", "pricing page"],
  ["product", "product pages"],
  ["blog", "blog"],
  ["careers", "careers page"],
]);

const ACTIVITY = [
  { kind: "content", one: "new post", many: "new posts" },
  { kind: "hiring", one: "job post", many: "job posts" },
  { kind: "mention", one: "mention", many: "mentions" },
] as const;

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function dayLabel(iso: string | null, timezone: string): string {
  const at = iso === null ? new Date(Number.NaN) : new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  try {
    return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: timezone });
  } catch {
    return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
}

function describedLine(facts: RivalFacts): string | null {
  const description = facts.description === null ? "" : shorten(facts.description, MAX_DESCRIPTION);
  return description === "" ? null : `In its own words: ${description}`;
}

function foundLine(facts: RivalFacts): string | null {
  const labels = [...ROLE_LABELS].flatMap(([role, label]) => (facts.roles.includes(role) ? [label] : []));
  return labels.length === 0 ? null : `Found on its site: ${labels.join(", ")}.`;
}

function watchedLine(facts: RivalFacts, timezone: string): string | null {
  const since = dayLabel(facts.firstReadAt, timezone);
  if (facts.reads === 0 || since === "") return null;
  const reads = countPhrase(facts.reads, "read", "reads");
  if (facts.changes === 0) return `Watched since ${since}: ${reads}, no changes yet.`;
  const last = dayLabel(facts.lastChangeAt, timezone);
  const changes = countPhrase(facts.changes, "change", "changes");
  return `Watched since ${since}: ${reads}, ${changes} recorded${last === "" ? "" : ` (last ${last})`}.`;
}

function feedLine(feed: FeedFacts | null, timezone: string): string | null {
  if (feed === null || feed.posts === 0) return null;
  const title = feed.latestTitle?.trim() ?? "";
  const day = dayLabel(feed.latestAt, timezone);
  const latest = title === "" ? "" : `, latest “${shorten(title, MAX_TITLE)}”${day === "" ? "" : ` (${day})`}`;
  return `Blog feed: ${countPhrase(feed.posts, "post", "posts")}${latest}.`;
}

function activityLine(facts: RivalFacts): string | null {
  const parts = ACTIVITY.flatMap((noun) => {
    const found = facts.kinds.find((row) => row.kind === noun.kind);
    return found === undefined || found.count === 0 ? [] : [countPhrase(found.count, noun.one, noun.many)];
  });
  return parts.length === 0 ? null : `Last ${String(BASELINE_DAYS)} days: ${parts.join(", ")}.`;
}

function feedOrActivity(facts: RivalFacts, timezone: string): string | null {
  const parts = [feedLine(facts.feed, timezone), activityLine(facts)].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" ");
}

export function baselineLines(facts: RivalFacts, timezone: string, options: { watched?: boolean } = {}): string[] {
  return [
    describedLine(facts),
    foundLine(facts),
    options.watched === false ? null : watchedLine(facts, timezone),
    feedOrActivity(facts, timezone),
  ].filter((line): line is string => line !== null);
}
