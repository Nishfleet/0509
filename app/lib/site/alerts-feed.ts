export interface FeedItem {
  signalId: string;
  title: string;
  summary: string;
  url: string;
  observedAt: string;
  band: "publish" | "uncertain" | "alert" | "check";
  isAlert: boolean;
  severity: "high" | "normal" | null;
  hasBefore: boolean;
  hasAfter: boolean;
}

export type ShotWhich = "before" | "after";

export function shotPath(signalId: string, which: ShotWhich): string {
  return `/app/alerts/shot/${encodeURIComponent(signalId)}/${which}`;
}

export function markTitle(item: FeedItem): string {
  return item.band === "uncertain" ? `Possibly: ${item.title}` : item.title;
}
