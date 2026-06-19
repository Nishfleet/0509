import { buildChangeIntelligenceSummary } from "~/lib/change-intelligence";
import type { AdRecord, WatchEventRecord, WatchlistRecord } from "~/lib/types";

export interface CounterMoveBrief {
  kind: "counter_move_brief";
  watchlistId: string;
  watchlistName: string;
  targetLabel: string;
  generatedAt: string;
  summary: string;
  moves: CounterMove[];
}

export interface CounterMove {
  eventId: string;
  eventType: WatchEventRecord["eventType"];
  title: string;
  priorityScore: number | null;
  priorityBand: string;
  evidence: string;
  recommendedAction: string;
  counterMove: string;
  advertiser: string | null;
  landingPageUrl: string | null;
}

export function buildCounterMoveBrief(input: {
  watchlist: WatchlistRecord;
  events: WatchEventRecord[];
  adsById: Map<string, AdRecord>;
  generatedAt?: string;
  limit?: number;
  timeZone?: string | null;
}): CounterMoveBrief {
  const limit = Math.max(1, Math.min(20, Math.floor(input.limit ?? 5)));
  const moves = [...input.events]
    .sort(compareEventsForBrief)
    .slice(0, limit)
    .map((event) => buildCounterMove(event, input.adsById.get(event.adId ?? "") ?? null, input.timeZone));

  return {
    kind: "counter_move_brief",
    watchlistId: input.watchlist.id,
    watchlistName: input.watchlist.name,
    targetLabel: input.watchlist.targetLabel,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: moves.length > 0
      ? `${moves.length} proof-backed move${moves.length === 1 ? "" : "s"} to review for ${input.watchlist.targetLabel}.`
      : `No proof-backed moves are ready for ${input.watchlist.targetLabel}.`,
    moves,
  };
}

function buildCounterMove(
  event: WatchEventRecord,
  ad: AdRecord | null,
  timeZone?: string | null,
): CounterMove {
  const intelligence = buildChangeIntelligenceSummary(event, timeZone);

  return {
    eventId: event.id,
    eventType: event.eventType,
    title: event.title,
    priorityScore: intelligence.priorityScore,
    priorityBand: intelligence.priorityBand,
    evidence: intelligence.proofTrail,
    recommendedAction: intelligence.recommendedAction,
    counterMove: counterMoveForEvent(event),
    advertiser: ad?.advertiser ?? readString(event.metadata, "advertiser"),
    landingPageUrl: ad?.landingPageUrl ?? readString(event.metadata, "landingPageUrl"),
  };
}

function compareEventsForBrief(left: WatchEventRecord, right: WatchEventRecord) {
  const leftScore = Number.isFinite(left.importanceScore) ? left.importanceScore : -1;
  const rightScore = Number.isFinite(right.importanceScore) ? right.importanceScore : -1;
  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function counterMoveForEvent(event: WatchEventRecord) {
  const from = readString(event.metadata, "from");
  const to = readString(event.metadata, "to");
  const change = from && to ? ` from "${from}" to "${to}"` : "";

  switch (event.eventType) {
    case "landing_page_offer_changed":
      return `Draft one counter-test against the offer shift${change}: price, bundle, guarantee, or checkout friction.`;
    case "landing_page_cta_changed":
      return `Compare your primary CTA against the new push${change}; decide whether your next test should move purchase, lead capture, or chat intent.`;
    case "landing_page_headline_changed":
      return `Write a positioning response to the headline change${change}; keep it as a test brief, not a site-wide rewrite.`;
    case "landing_page_url_changed":
      return `Open the new destination and map the funnel change${change}; brief the sales or growth team on what changed before copying it.`;
    case "landing_page_form_changed":
      return `Review the capture step change${change}; decide whether to simplify, add qualification, or answer the objection earlier.`;
    case "ad_new":
      return "Save the new creative angle, compare it with your current hook, and brief one launch-week counter-test.";
    case "ad_inactive":
      return "Check whether the paused campaign was replaced; avoid reacting until the next active creative or offer appears.";
    default:
      return "Review the proof, decide whether this changes your next campaign decision, and keep the response reversible.";
  }
}

function readString(value: unknown, field: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}
