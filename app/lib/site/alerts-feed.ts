import type { ChangeBand } from "../shot-path";

export interface FeedItem {
  signalId: string;
  title: string;
  summary: string;
  url: string;
  observedAt: string;
  band: ChangeBand;
  isAlert: boolean;
  severity: "high" | "normal" | null;
  hasBefore: boolean;
  hasAfter: boolean;
}

export function markTitle(item: Pick<FeedItem, "title" | "band">): string {
  return item.band === "uncertain" ? `Possibly: ${item.title}` : item.title;
}
