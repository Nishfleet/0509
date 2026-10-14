import { env } from "cloudflare:workers";

import type { SiteChangeRow } from "./data/signal.server";
import { readSiteChangePayload, readSiteChanges } from "./data/signal.server";
import { landingWorkspaceId } from "./env.server";
import { offBrandSite } from "./site/alternate-sources";
import type { ChangeMark, ChangeShot, PairedSiteChange, SiteChangePayload, SiteChangeView } from "./site-change";
import { whyFlagged } from "./why-flagged";
import {
  captureLabel,
  changeHeadline,
  markFromHunks,
  pageLabel,
  parseDiffHunks,
  parseSiteChangePayload,
  pickLandingMarks,
  provenanceNote,
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

function shot(id: string, side: ShotSide, capture: { key: string | null; at: string | null }): ChangeShot {
  const { key, at } = capture;
  if (key === null || at === null) {
    return { missing: side === "before" ? "No screenshot of the earlier version" : "Screenshot unavailable" };
  }
  return { src: shotPath(id, side), capturedAt: captureLabel(at) };
}

interface MarkRead {
  mark: ChangeMark | null;
  unavailable: boolean;
}

async function readMark(diffKey: string | null): Promise<MarkRead> {
  if (diffKey === null) return { mark: null, unavailable: false };
  try {
    const object = await env.SNAPSHOTS.get(diffKey);
    if (object === null) return { mark: null, unavailable: false };
    const hunks = parseDiffHunks(await object.text());
    return { mark: hunks === null ? null : markFromHunks(hunks), unavailable: false };
  } catch (cause) {
    console.warn(JSON.stringify({ event: "site_changes.diff_unavailable", error: String(cause).slice(0, 200) }));
    return { mark: null, unavailable: true };
  }
}

function seenOn(row: SiteChangeRow, payload: SiteChangePayload): string | null {
  return row.entity_role === "self" ? null : offBrandSite(payload.page.url, row.entity_domain);
}

async function toView(row: SiteChangeRow, payload: SiteChangePayload): Promise<SiteChangeView> {
  const isSelf = row.entity_role === "self";
  const { mark, unavailable } = await readMark(payload.diffKey);
  return {
    id: row.id,
    entityId: row.entity_id,
    isSelf,
    headline: changeHeadline({ name: row.entity_name ?? row.entity_domain, isSelf, role: payload.page.role }),
    page: pageLabel(payload.page.role),
    url: row.url ?? payload.page.url,
    observedAt: row.observed_at,
    capturedAt: captureLabel(row.after_at ?? row.observed_at),
    wordsChanged: payload.wordsAdded + payload.wordsRemoved,
    provenance: provenanceNote({ viaArchive: payload.viaArchive === true, seenOn: seenOn(row, payload) }),
    sentence: wordsSentence(payload.wordsAdded, payload.wordsRemoved),
    mark,
    detailsUnavailable: unavailable,
    before: shot(row.id, "before", { key: payload.before.screenshotKey, at: row.before_at }),
    after: shot(row.id, "after", { key: payload.after.screenshotKey, at: row.after_at }),
    whyFlagged: whyFlagged({
      verdictId: row.verdict_id,
      p: row.verdict_p,
      reason: row.verdict_reason,
      decidedAt: row.verdict_decided_at,
      compared: [
        { label: "Page", value: pageLabel(payload.page.role) },
        { label: "Link", value: row.url ?? payload.page.url },
        { label: "Before", value: row.before_at ?? "—" },
        { label: "After", value: row.after_at ?? row.observed_at },
      ],
    }),
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

export async function readBiggestSiteChanges(workspaceId: string, since: string): Promise<SiteChangeView[]> {
  const rows = await readSiteChanges({ workspaceId, entityId: null, since, limit: 200 });
  const winners = new Map<string, { row: SiteChangeRow; payload: SiteChangePayload }>();
  for (const row of rows) {
    const payload = parseSiteChangePayload(row.payload_json);
    if (payload === null) continue;
    const current = winners.get(row.entity_id);
    if (
      current === undefined ||
      payload.wordsAdded + payload.wordsRemoved > current.payload.wordsAdded + current.payload.wordsRemoved
    ) {
      winners.set(row.entity_id, { row, payload });
    }
  }
  return Promise.all([...winners.values()].map(({ row, payload }) => toView(row, payload)));
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
  return env.SNAPSHOTS.get(key).catch((cause: unknown) => {
    console.warn(JSON.stringify({ event: "site_changes.shot_unavailable", error: String(cause).slice(0, 200) }));
    return null;
  });
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
