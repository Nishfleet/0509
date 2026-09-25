import { env } from "cloudflare:workers";

import type { ShotWhich } from "./alerts-feed";
import { readChangeShot } from "../site-changes.server";
import { readSiteChangePayload } from "../data/signal.server";

const SHOT_PREFIX = "snapshot/site/";

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

function shotKey(json: string, which: ShotWhich): string | null {
  const keys = publishedKeys(json);
  if (keys === null) return null;
  const key = which === "before" ? keys.previousScreenshotKey : keys.screenshotKey;
  return key?.startsWith(SHOT_PREFIX) === true ? key : null;
}

export async function loadShot(
  workspaceId: string,
  signalId: string,
  which: ShotWhich,
): Promise<R2ObjectBody | null> {
  const swept = await readChangeShot(workspaceId, signalId, which);
  if (swept !== null) return swept;
  const json = await readSiteChangePayload(workspaceId, signalId);
  const key = json === null ? null : shotKey(json, which);
  if (key === null) return null;
  return await env.SNAPSHOTS.get(key);
}
