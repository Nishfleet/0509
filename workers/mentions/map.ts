import { tz } from "@date-fns/tz";
import { isSameDay } from "date-fns";

export const SOURCE_LABELS: Record<string, string> = {
  "news.google_rss": "Google News",
  "reddit.search_rss": "Reddit",
  "hn.algolia": "Hacker News",
  "youtube.channel_rss": "YouTube",
  "medium.tag_rss": "Medium",
  "ddg.html": "DuckDuckGo",
  "x.apify": "X",
};

export type Reliability = "official_api" | "rss" | "scraped_page" | "best_effort";

export interface SourceConfig {
  rateClass: "fast" | "paced";
  canaryUrl: string;
  expectNonzero: boolean;
  approved_cost: null;
  quotedCost?: string;
  disabledReason?: string;
  lastCanaryOn?: string;
  lastCanaryCount?: number;
  degradedSince?: string | null;
  degradedReason?: string | null;
  lastGoodAt?: string | null;
}

export interface EligibleWatch {
  watchId: string;
  sourceId: string;
  entityId: string;
  workspaceId: string;
  pluginKey: string;
  reliability: Reliability;
  rateClass: "fast" | "paced";
}

export interface MentionMessage {
  watchId: string;
  sourceId: string;
  entityId: string;
  workspaceId: string;
}

type Band = "high" | "low" | "mid";

export interface SurvivorRow {
  id: string;
  observedAt: string;
  reliability: Reliability;
  canonicalUrl: string;
}

const RELIABILITY_RANK: Record<Reliability, number> = {
  official_api: 4,
  rss: 3,
  scraped_page: 2,
  best_effort: 1,
};

export function isReliability(value: string): value is Reliability {
  return value in RELIABILITY_RANK;
}

export function readSourceConfig(raw: string): SourceConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    parsed = {};
  }
  const record = parsed && typeof parsed === "object" ? parsed : {};
  const rateClass = "rateClass" in record && record.rateClass === "paced" ? "paced" : "fast";
  const canaryUrl = "canaryUrl" in record && typeof record.canaryUrl === "string" ? record.canaryUrl : "";
  const expectNonzero = !("expectNonzero" in record) || record.expectNonzero !== false;
  const quotedCost = "quotedCost" in record && typeof record.quotedCost === "string" ? record.quotedCost : undefined;
  const disabledReason =
    "disabledReason" in record && typeof record.disabledReason === "string" ? record.disabledReason : undefined;
  const lastCanaryOn =
    "lastCanaryOn" in record && typeof record.lastCanaryOn === "string" ? record.lastCanaryOn : undefined;
  const lastCanaryCount =
    "lastCanaryCount" in record && typeof record.lastCanaryCount === "number" ? record.lastCanaryCount : undefined;
  const degradedSince =
    "degradedSince" in record && (typeof record.degradedSince === "string" || record.degradedSince === null)
      ? record.degradedSince
      : undefined;
  const degradedReason =
    "degradedReason" in record && (typeof record.degradedReason === "string" || record.degradedReason === null)
      ? record.degradedReason
      : undefined;
  const lastGoodAt =
    "lastGoodAt" in record && (typeof record.lastGoodAt === "string" || record.lastGoodAt === null)
      ? record.lastGoodAt
      : undefined;
  return {
    rateClass,
    canaryUrl,
    expectNonzero,
    approved_cost: null,
    quotedCost,
    disabledReason,
    lastCanaryOn,
    lastCanaryCount,
    degradedSince,
    degradedReason,
    lastGoodAt,
  };
}

export function isPolled(input: { entityState: string; kind: string; isEnabled: number }): boolean {
  return input.entityState === "on" && input.kind === "mentions" && input.isEnabled === 1;
}

export function queueFor(input: { pluginKey: string; reliability: string; rateClass: string }): "fast" | "paced" {
  if (input.pluginKey === "reddit.search_rss" || input.reliability === "scraped_page" || input.rateClass === "paced") {
    return "paced";
  }
  return "fast";
}

export function splitMessages(rows: EligibleWatch[]): { fast: MentionMessage[]; paced: MentionMessage[] } {
  const fast: MentionMessage[] = [];
  const paced: MentionMessage[] = [];
  for (const row of rows) {
    const message = {
      watchId: row.watchId,
      sourceId: row.sourceId,
      entityId: row.entityId,
      workspaceId: row.workspaceId,
    };
    if (queueFor(row) === "paced") paced.push(message);
    else fast.push(message);
  }
  return { fast, paced };
}

function isGoogleNewsUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "news.google.com" || host.endsWith(".news.google.com");
  } catch {
    return false;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function band(p: number): Band {
  if (p >= 0.9) return "high";
  if (p <= 0.1) return "low";
  return "mid";
}

export function pickSurvivor<T extends SurvivorRow>(rows: readonly T[]): T {
  const first = rows[0];
  if (!first) throw new Error("pickSurvivor requires a row");
  return rows.reduce((best, row) => {
    if (row.observedAt < best.observedAt) return row;
    if (row.observedAt > best.observedAt) return best;
    return RELIABILITY_RANK[row.reliability] > RELIABILITY_RANK[best.reliability] ? row : best;
  }, first);
}

export function upgradedCanonical(survivorUrl: string, otherUrl: string): string | null {
  if (isGoogleNewsUrl(survivorUrl) && !isGoogleNewsUrl(otherUrl)) return otherUrl;
  return null;
}

export interface MentionPayload {
  publisher: string | null;
  collapsed_into?: string;
  d5?: "keep" | "possibly";
  d6?: "feed" | "normal" | "show_all";
  unreviewed?: boolean;
  titleHash?: string;
}

export function readPayload(raw: string | null): MentionPayload {
  if (!raw) return { publisher: null };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { publisher: null };
    const publisher = "publisher" in parsed && typeof parsed.publisher === "string" ? parsed.publisher : null;
    const collapsed_into =
      "collapsed_into" in parsed && typeof parsed.collapsed_into === "string" ? parsed.collapsed_into : undefined;
    const d5 = "d5" in parsed && (parsed.d5 === "keep" || parsed.d5 === "possibly") ? parsed.d5 : undefined;
    const d6 =
      "d6" in parsed && (parsed.d6 === "feed" || parsed.d6 === "normal" || parsed.d6 === "show_all")
        ? parsed.d6
        : undefined;
    const unreviewed = "unreviewed" in parsed && parsed.unreviewed === true ? true : undefined;
    const titleHash = "titleHash" in parsed && typeof parsed.titleHash === "string" ? parsed.titleHash : undefined;
    return { publisher, collapsed_into, d5, d6, unreviewed, titleHash };
  } catch {
    return { publisher: null };
  }
}

export function showInDefaultFeed(payload: MentionPayload): boolean {
  if (payload.collapsed_into) return false;
  if (payload.d6 === "show_all") return false;
  return true;
}

export function andMoreLabel(count: number): string | null {
  if (count < 1) return null;
  return `and ${String(count)} more`;
}

export function mentionWhen(publishedAt: string | null, observedAt: string, timeZone: string, now: Date): string {
  const zone = tz(timeZone);
  if (publishedAt === null) {
    if (isSameDay(observedAt, now, { in: zone })) return "found today";
    return `found ${new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium" }).format(new Date(observedAt))}`;
  }
  return new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium" }).format(new Date(publishedAt));
}

export interface SourceHealth {
  pluginKey: string;
  label: string;
  isEnabled: boolean;
  degradedSince: string | null;
  degradedReason: string | null;
  lastGoodAt: string | null;
  lastSnapshotAt: string | null;
}

export function sourcePill(source: SourceHealth): { tone: "normal" | "degraded"; text: string } | null {
  if (!source.isEnabled) return null;
  if (source.degradedSince) {
    return { tone: "degraded", text: `${source.label}: not answering since ${source.degradedSince}` };
  }
  return { tone: "normal", text: source.label };
}

export function allSourcesDown(sources: readonly SourceHealth[]): boolean {
  const enabled = sources.filter((source) => source.isEnabled);
  return enabled.length > 0 && enabled.every((source) => source.degradedSince !== null);
}

export function snapshotPlan(input: {
  previousHash: string | null;
  nextHash: string;
  hasUnreviewed: boolean;
  alreadyToday: boolean;
}): { writeRow: boolean; reuseKey: boolean; judge: boolean } {
  if (input.alreadyToday) return { writeRow: false, reuseKey: true, judge: input.hasUnreviewed };
  const same = input.previousHash !== null && input.previousHash === input.nextHash;
  return { writeRow: true, reuseKey: same, judge: !same || input.hasUnreviewed };
}

export interface Sighting { sourceKey: string; dedupKey: string; at: string }

export function addSighting(existing: string | null, sighting: Sighting, metrics: Record<string, number>): string {
  let metricsExisting: Record<string, number> = {};
  let sightings: Sighting[] = [];
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as unknown;
      if (parsed && typeof parsed === "object") {
        if ("metrics" in parsed && parsed.metrics && typeof parsed.metrics === "object") {
          for (const [key, value] of Object.entries(parsed.metrics)) {
            if (typeof value === "number") metricsExisting[key] = value;
          }
        }
        if ("sightings" in parsed && Array.isArray(parsed.sightings)) {
          for (const row of parsed.sightings as unknown[]) {
            if (!row || typeof row !== "object") continue;
            if (!("sourceKey" in row) || !("dedupKey" in row) || !("at" in row)) continue;
            if (typeof row.sourceKey !== "string" || typeof row.dedupKey !== "string" || typeof row.at !== "string") {
              continue;
            }
            sightings.push({ sourceKey: row.sourceKey, dedupKey: row.dedupKey, at: row.at });
          }
        }
      }
    } catch {
      metricsExisting = {};
      sightings = [];
    }
  }
  sightings.push(sighting);
  return JSON.stringify({ metrics: { ...metricsExisting, ...metrics }, sightings });
}

export function applyCanary(config: SourceConfig, count: number, nowIso: string): SourceConfig {
  if (count > 0 || !config.expectNonzero) {
    return {
      ...config,
      lastCanaryOn: nowIso.slice(0, 10),
      lastCanaryCount: count,
      lastGoodAt: nowIso,
      degradedSince: null,
      degradedReason: null,
      approved_cost: null,
    };
  }
  return {
    ...config,
    lastCanaryOn: nowIso.slice(0, 10),
    lastCanaryCount: count,
    degradedSince: config.degradedSince ?? nowIso,
    degradedReason: config.degradedReason ?? "canary returned zero",
    approved_cost: null,
  };
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

export function r2Key(workspaceId: string, watchId: string, fetchedAt: string, payloadHash: string): string {
  return `mentions/${workspaceId}/${watchId}/${fetchedAt.slice(0, 10)}/${payloadHash}`;
}

export function d5Action(p: number): "drop" | "keep" | "possibly" {
  const verdict = band(p);
  if (verdict === "low") return "drop";
  if (verdict === "high") return "keep";
  return "possibly";
}

export function d6Action(p: number): "feed" | "show_all" | "normal" {
  const verdict = band(p);
  if (verdict === "high") return "feed";
  if (verdict === "low") return "show_all";
  return "normal";
}

export function d8Collapses(p: number): boolean {
  return band(p) !== "low";
}
