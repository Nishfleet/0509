import { env } from "cloudflare:workers";

import type { SiteChangeRow } from "./data/signal.server";
import { readSiteChangePayload, readSiteChanges } from "./data/signal.server";
import { landingWorkspaceId } from "./env.server";
import type { ChangeMark, ChangeShot, PairedSiteChange, SiteChangePayload, SiteChangeView } from "./site-change";
import {
  captureLabel,
  changeHeadline,
  markFromHunks,
  pageLabel,
  parseDiffHunks,
  parseSiteChangePayload,
  pickLandingMarks,
  wordsSentence,
} from "./site-change";

export type ShotSide = "before" | "after";

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysBefore(now: Date, days: number): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

function shotPath(id: string, side: ShotSide): string {
  return `/app/changes/${encodeURIComponent(id)}/${side}`;
}

function shot(id: string, side: ShotSide, key: string | null, at: string | null): ChangeShot {
  if (key === null || at === null) {
    return { missing: side === "before" ? "No screenshot of the earlier version" : "Screenshot unavailable" };
  }
  return { src: shotPath(id, side), capturedAt: captureLabel(at) };
}

async function readMark(diffKey: string | null): Promise<ChangeMark | null> {
  if (diffKey === null) return null;
  const object = await env.SNAPSHOTS.get(diffKey);
  if (object === null) return null;
  const hunks = parseDiffHunks(await object.text());
  return hunks === null ? null : markFromHunks(hunks);
}

async function toView(row: SiteChangeRow, payload: SiteChangePayload): Promise<SiteChangeView> {
  const isSelf = row.entity_role === "self";
  return {
    id: row.id,
    entityId: row.entity_id,
    isSelf,
    headline: changeHeadline({ name: row.entity_name ?? row.entity_domain, isSelf, role: payload.page.role }),
    page: pageLabel(payload.page.role),
    url: row.url,
    observedAt: row.observed_at,
    capturedAt: captureLabel(row.after_at ?? row.observed_at),
    wordsChanged: payload.wordsAdded + payload.wordsRemoved,
    sentence: wordsSentence(payload.wordsAdded, payload.wordsRemoved),
    mark: await readMark(payload.diffKey),
    before: shot(row.id, "before", payload.before.screenshotKey, row.before_at),
    after: shot(row.id, "after", payload.after.screenshotKey, row.after_at),
  };
}

export async function readSiteChangeViews(input: {
  workspaceId: string;
  entityId: string | null;
  since: string;
  limit: number;
}): Promise<SiteChangeView[]> {
  const rows = await readSiteChanges(input);
  const parsed = rows.flatMap((row) => {
    const payload = parseSiteChangePayload(row.payload_json);
    return payload === null ? [] : [{ row, payload }];
  });
  return Promise.all(parsed.map(({ row, payload }) => toView(row, payload)));
}

const SHOT_PREFIX = "snapshot/site/";

export async function readChangeShot(
  workspaceId: string,
  signalId: string,
  side: ShotSide,
): Promise<R2ObjectBody | null> {
  const json = await readSiteChangePayload(workspaceId, signalId);
  const payload = json === null ? null : parseSiteChangePayload(json);
  const key = payload?.[side].screenshotKey;
  if (!key?.startsWith(SHOT_PREFIX)) return null;
  return env.SNAPSHOTS.get(key);
}

const LANDING_WINDOW_DAYS = 7;
const LANDING_READ_LIMIT = 24;

export async function readLandingMarks(now: Date): Promise<PairedSiteChange[]> {
  const workspaceId = landingWorkspaceId();
  if (workspaceId === null) return [];
  const views = await readSiteChangeViews({
    workspaceId,
    entityId: null,
    since: daysBefore(now, LANDING_WINDOW_DAYS),
    limit: LANDING_READ_LIMIT,
  });
  return pickLandingMarks(views);
}
