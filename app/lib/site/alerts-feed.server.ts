import { env } from "cloudflare:workers";

import { parseSiteChangePayload } from "../site-change";
import type { ShotWhich } from "./alerts-feed";

const BANDS = ["publish", "uncertain", "alert", "check"] as const;

interface PublishedKeys {
  screenshotKey: string | null;
  previousScreenshotKey: string;
}

function publishedKeys(json: string): PublishedKeys | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    console.log(JSON.stringify({ event: "alerts_feed.unreadable", error: String(error) }));
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const screenshotKey = record.screenshotKey;
  const previousScreenshotKey = record.previousScreenshotKey;
  const band = record.band;
  if (
    (typeof screenshotKey !== "string" && screenshotKey !== null) ||
    typeof previousScreenshotKey !== "string" ||
    typeof band !== "string" ||
    BANDS.every((candidate) => candidate !== band)
  ) {
    return null;
  }
  return { screenshotKey, previousScreenshotKey };
}

function publishedShot(json: string, which: ShotWhich): string | null {
  const keys = publishedKeys(json);
  if (keys === null) return null;
  return which === "before" ? keys.previousScreenshotKey : keys.screenshotKey;
}

function sweptShot(json: string, which: ShotWhich): string | null {
  const swept = parseSiteChangePayload(json);
  if (swept === null) return null;
  return swept[which].screenshotKey;
}

function shotKey(json: string, which: ShotWhich): string | null {
  return publishedShot(json, which) ?? sweptShot(json, which);
}

export async function loadShot(
  workspaceId: string,
  signalId: string,
  which: ShotWhich,
): Promise<R2ObjectBody | null> {
  const row = await env.DB.prepare("SELECT payload_json FROM signal WHERE id = ? AND workspace_id = ?")
    .bind(signalId, workspaceId)
    .first<{ payload_json: string | null }>();
  if (row === null) return null;
  const key = row.payload_json === null ? null : shotKey(row.payload_json, which);
  if (key === null) return null;
  return await env.SNAPSHOTS.get(key);
}
