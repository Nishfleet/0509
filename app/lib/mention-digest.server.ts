import type { AppEnv } from "~/lib/env.server";
import { listPresenceItems, listTrackedEntities } from "~/lib/presence-data.server";
import { formatCoverageLabel } from "~/lib/presence-display";
import { presenceUrlHash } from "~/lib/presence-hash";
import type {
  PresenceConnectorId,
  PresenceItemRecord,
  TrackedEntityRecord,
} from "~/lib/presence-types";

export interface MentionDigestOptions {
  /** ISO 8601 timestamp; only items observed after this are candidates. */
  since: string;
  /** Connectors to treat as mention sources. */
  mentionConnectorIds?: PresenceConnectorId[];
  /** Max items per connector. */
  limit?: number;
}

const DEFAULT_MENTION_CONNECTORS: PresenceConnectorId[] = ["rss", "x", "reddit"];

/**
 * Builds the mention-section lines for the presence digest.
 *
 * - Only shows lines for entities that actually have at least one mention item
 *   in the lookback; no "New mentions" header is fabricated when there are none.
 * - Marks `(new)` only when the earliest `createdAt` for the same
 *   `(tracked_entity_id, url_hash)` falls inside the lookback window.
 * - Reuses `presenceUrlHash` and `presence_item.url_hash` so the marker is
 *   stable with the rest of the presence substrate.
 */
export async function buildMentionDigestLines(
  env: AppEnv,
  userId: string,
  options: MentionDigestOptions,
): Promise<string[]> {
  const connectorIds = options.mentionConnectorIds ?? DEFAULT_MENTION_CONNECTORS;
  const entities = await listTrackedEntities(env, userId);
  const entityLabelById = new Map(entities.map((entity) => [entity.id, entity.label]));

  const mentionItems: PresenceItemRecord[] = [];
  for (const connectorId of connectorIds) {
    const items = await listPresenceItems(env, userId, {
      connectorId,
      since: options.since,
      limit: options.limit ?? 25,
    });
    mentionItems.push(
      ...items.filter(
        (item) =>
          connectorId === item.connectorId &&
          (item.canonicalUrl || item.urlHash),
      ),
    );
  }

  if (mentionItems.length === 0) {
    return [];
  }

  const itemUrlHashes = await resolveUrlHashes(mentionItems);
  const firstObservedByUrlHash = await firstObservedAtByUrlHash(
    env,
    userId,
    mentionItems,
    itemUrlHashes,
  );

  const lines: string[] = [];
  const grouped = groupBy(mentionItems, (item) => item.trackedEntityId);
  const entityIds = [...grouped.keys()].sort((a, b) =>
    compareByLatestObserved(grouped.get(a)!, grouped.get(b)!),
  );

  for (const entityId of entityIds) {
    const items = grouped.get(entityId)!;
    const label = entityLabelById.get(entityId) ?? "Tracked entity";
    for (const item of items) {
      const urlHash = itemUrlHashes.get(item.id);
      const isNew = isFirstObservedInWindow(
        item,
        urlHash,
        firstObservedByUrlHash,
        options.since,
      );
      const newMarker = isNew ? " (new)" : "";
      lines.push(
        `${label} — ${item.title}${newMarker} (${formatCoverageLabel(item.connectorId)})`,
      );
    }
  }

  return lines;
}

async function resolveUrlHashes(
  items: PresenceItemRecord[],
): Promise<Map<string, string>> {
  const urlHashes = new Map<string, string>();
  await Promise.all(
    items.map(async (item) => {
      const urlHash = item.urlHash ?? (item.canonicalUrl
        ? await presenceUrlHash(item.canonicalUrl)
        : null);
      if (urlHash) {
        urlHashes.set(item.id, urlHash);
      }
    }),
  );
  return urlHashes;
}

async function firstObservedAtByUrlHash(
  env: AppEnv,
  userId: string,
  items: PresenceItemRecord[],
  itemUrlHashes: Map<string, string>,
): Promise<Map<string, string>> {
  const pairs = new Map<string, { trackedEntityId: string; urlHash: string }>();
  for (const item of items) {
    const urlHash = itemUrlHashes.get(item.id);
    if (!urlHash) continue;
    const key = `${item.trackedEntityId}:${urlHash}`;
    pairs.set(key, { trackedEntityId: item.trackedEntityId, urlHash });
  }

  const unique = [...pairs.values()];
  if (unique.length === 0) {
    return new Map();
  }

  const conditions = unique.map(() => "(tracked_entity_id = ? AND url_hash = ?)").join(" OR ");
  const binds = unique.flatMap((pair) => [pair.trackedEntityId, pair.urlHash]);

  if (!env.DB) {
    return new Map();
  }

  const rows = await env.DB
    .prepare(
      `SELECT tracked_entity_id, url_hash, MIN(created_at) AS first_at
       FROM presence_item
       WHERE user_id = ? AND is_tombstone = 0 AND (${conditions})
       GROUP BY tracked_entity_id, url_hash`,
    )
    .bind(userId, ...binds)
    .all<{
      tracked_entity_id: string;
      url_hash: string;
      first_at: string;
    }>();

  const firstAt = new Map<string, string>();
  for (const row of rows.results ?? []) {
    firstAt.set(`${row.tracked_entity_id}:${row.url_hash}`, row.first_at);
  }
  return firstAt;
}

function isFirstObservedInWindow(
  item: PresenceItemRecord,
  urlHash: string | undefined,
  firstObservedByUrlHash: Map<string, string>,
  since: string,
): boolean {
  if (!urlHash) return false;
  const firstAt = firstObservedByUrlHash.get(`${item.trackedEntityId}:${urlHash}`);
  if (!firstAt) return false;
  return firstAt > since;
}

function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return groups;
}

function compareByLatestObserved(a: PresenceItemRecord[], b: PresenceItemRecord[]) {
  const latestA = a.reduce((latest, item) => (item.observedAt > latest ? item.observedAt : latest), a[0]?.observedAt ?? "");
  const latestB = b.reduce((latest, item) => (item.observedAt > latest ? item.observedAt : latest), b[0]?.observedAt ?? "");
  return latestB.localeCompare(latestA);
}
