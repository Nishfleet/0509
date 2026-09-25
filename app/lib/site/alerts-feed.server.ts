import { env } from "cloudflare:workers";

import type { ChangeAlertFeedRow } from "../data/signal.server";
import { readChangeAlertFeed } from "../data/signal.server";
import { isShotKey } from "../shot-path";
import { parseChangeShotKeys } from "../site-change";
import { daysBefore } from "../site-changes.server";
import type { FeedItem } from "./alerts-feed";

const FEED_DAYS = 30;
const FEED_LIMIT = 50;

const BAND_ORDER: Record<FeedItem["band"], number> = { alert: 0, check: 1, publish: 2, uncertain: 3 };

function severityOf(value: string | null): FeedItem["severity"] {
  return value === "high" || value === "normal" ? value : null;
}

function toFeedItem(row: ChangeAlertFeedRow, keys: ReturnType<typeof parseChangeShotKeys>): FeedItem {
  return {
    signalId: row.id,
    title: row.title ?? "",
    summary: row.summary ?? "",
    url: row.url,
    observedAt: row.observed_at,
    band: keys?.band ?? "publish",
    isAlert: row.alert_id !== null,
    severity: severityOf(row.severity),
    hasBefore: false,
    hasAfter: false,
  };
}

function feedOrder(left: FeedItem, right: FeedItem): number {
  if (left.isAlert !== right.isAlert) return left.isAlert ? -1 : 1;
  if (left.isAlert && left.severity !== right.severity) return left.severity === "high" ? -1 : 1;
  const leftBand = BAND_ORDER[left.band];
  const rightBand = BAND_ORDER[right.band];
  if (leftBand !== rightBand) return leftBand - rightBand;
  return right.observedAt.localeCompare(left.observedAt);
}

async function shotExists(key: string | null): Promise<boolean> {
  return isShotKey(key) && (await env.SNAPSHOTS.head(key)) !== null;
}

export async function loadAlertsFeed(workspaceId: string, now: Date = new Date()): Promise<FeedItem[]> {
  const rows = await readChangeAlertFeed(workspaceId, daysBefore(now, FEED_DAYS), FEED_LIMIT);
  const items = await Promise.all(
    rows.map(async (row) => {
      const keys = parseChangeShotKeys(row.payload_json);
      const item = toFeedItem(row, keys);
      const [hasBefore, hasAfter] = await Promise.all([
        keys === null ? false : shotExists(keys.before),
        keys === null ? false : shotExists(keys.after),
      ]);
      return { ...item, hasBefore, hasAfter };
    }),
  );
  return [...items].sort(feedOrder);
}
