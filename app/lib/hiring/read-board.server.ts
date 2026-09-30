import { env } from "cloudflare:workers";
import { z } from "zod";

import type { BoardSnapshot } from "../data/snapshot.server";
import { insertBoardSnapshot, latestBoardSnapshot } from "../data/snapshot.server";
import { insertHiringSignals } from "../data/signal.server";
import type { readHiringTargets } from "../data/watch.server";
import { deactivateWatch, markWatchPolled } from "../data/watch.server";
import { fetchOutbound } from "../fetch/outbound.server";
import type { SweepTick } from "../site/sweep.server";
import { listingForBoard } from "./discover-board.server";
import type { BoardPlatform } from "./listing";
import type { OpenRole } from "./listing";
import { nextListingUrl, parseListing } from "./listing";

export type HiringTarget = Awaited<ReturnType<typeof readHiringTargets>>[number];

export interface BoardResult {
  outcome: "first" | "unchanged" | "changed" | "gone";
  newRoles: number;
}

const previousRolesSchema = z.array(z.object({ id: z.string() }));

async function fetchListingPages(platform: BoardPlatform, boardUrl: string, url: string): Promise<OpenRole[] | "gone"> {
  const response = await fetchOutbound(url, { headers: {} });
  if (response.status === 404 || response.status === 410) return "gone";
  if (!response.ok) {
    throw new Error(`hiring.listing_status ${String(response.status)} for ${url}`);
  }
  const body = await response.text();
  const pageRoles = parseListing(platform, body, boardUrl);
  const next = nextListingUrl(platform, url, body);
  if (next === null) return pageRoles;
  const rest = await fetchListingPages(platform, boardUrl, next);
  return rest === "gone" ? "gone" : [...pageRoles, ...rest];
}

function dedupeRoles(fetched: readonly OpenRole[]): OpenRole[] {
  const seen = new Set<string>();
  return fetched.filter((role) => {
    if (seen.has(role.id)) return false;
    seen.add(role.id);
    return true;
  });
}

async function hashRoleIds(roles: readonly OpenRole[]): Promise<string> {
  const ids = roles.map((role) => role.id).sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ids.join("\n")));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storeBoardSnapshot(input: {
  snapshotId: string;
  watchId: string;
  r2Key: string;
  hash: string;
  roles: readonly OpenRole[];
  now: string;
}): Promise<void> {
  await env.SNAPSHOTS.put(input.r2Key, JSON.stringify(input.roles), {
    httpMetadata: { contentType: "application/json" },
  });
  await insertBoardSnapshot({
    id: input.snapshotId,
    watchId: input.watchId,
    fetchedAt: input.now,
    r2Key: input.r2Key,
    hash: input.hash,
    itemCount: input.roles.length,
  });
}

async function fileFreshRoles(input: {
  target: HiringTarget;
  previous: BoardSnapshot;
  roles: readonly OpenRole[];
  snapshotId: string;
  now: string;
}): Promise<number> {
  const { target, previous, roles, snapshotId, now } = input;
  const previousObject = previous.r2Key === null ? null : await env.SNAPSHOTS.get(previous.r2Key);
  if (previousObject === null) throw new Error("hiring.previous_snapshot_missing");
  const stored = previousRolesSchema.parse(JSON.parse(await previousObject.text()));
  const previousIds = new Set(stored.map((role) => role.id));
  const fresh = roles.filter((role) => !previousIds.has(role.id));
  await insertHiringSignals(
    fresh.map((role) => ({
      id: crypto.randomUUID(),
      workspaceId: target.workspaceId,
      entityId: target.entityId,
      sourceId: target.sourceId,
      watchId: target.watchId,
      snapshotId,
      roleId: role.id,
      platform: target.platform,
      title: role.title,
      location: role.location,
      team: role.team,
      url: role.url,
      publishedAt: role.postedAt,
      observedAt: now,
    })),
  );
  return fresh.length;
}

export async function readBoard(target: HiringTarget, tick: SweepTick): Promise<BoardResult> {
  const listing = listingForBoard(target.boardUrl);
  if (listing === null) throw new Error(`hiring.unknown_board ${target.boardUrl}`);
  try {
    const fetched = await fetchListingPages(listing.platform, target.boardUrl, listing.listingUrl);
    if (fetched === "gone") {
      await deactivateWatch(target.watchId);
      return { outcome: "gone", newRoles: 0 };
    }
    const roles = dedupeRoles(fetched);
    const hash = await hashRoleIds(roles);
    const previous = await latestBoardSnapshot(target.watchId, tick.plannedAt);
    const snapshotId = `${tick.instanceId}-${target.watchId}`;
    const now = new Date().toISOString();
    if (previous !== null && previous.hash === hash) {
      await insertBoardSnapshot({
        id: snapshotId,
        watchId: target.watchId,
        fetchedAt: now,
        r2Key: previous.r2Key,
        hash,
        itemCount: roles.length,
      });
      await markWatchPolled(target.watchId, now);
      return { outcome: "unchanged", newRoles: 0 };
    }
    const r2Key = `snapshot/hiring/${target.watchId}/${snapshotId}.json`;
    await storeBoardSnapshot({ snapshotId, watchId: target.watchId, r2Key, hash, roles, now });
    if (previous === null) {
      await markWatchPolled(target.watchId, now);
      return { outcome: "first", newRoles: 0 };
    }
    const newRoles = await fileFreshRoles({ target, previous, roles, snapshotId, now });
    await markWatchPolled(target.watchId, now);
    return { outcome: "changed", newRoles };
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "hiring.read_failed",
        watchId: target.watchId,
        boardUrl: target.boardUrl,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
}
