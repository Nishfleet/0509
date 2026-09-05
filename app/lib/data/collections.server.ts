/**
 * Collection / collection-item / tag D1 persistence.
 * Product code should keep importing from `~/lib/data.server` until later
 * migration PRs. Leaf imports ads via `~/lib/data/ads.server` for upsertAd
 * (no `~/lib/data.server` cycle).
 */

import { upsertAd } from "~/lib/data/ads.server";
import {
  ensureDb,
  execute as run,
  queryAll as many,
  queryOne as one,
} from "~/lib/data/d1.server";
import {
  createId,
  jsonValue,
  nowIso,
  parseJson,
} from "~/lib/data/helpers.server";
import type { AppEnv } from "~/lib/env.server";
import { buildExternalProofAd } from "~/lib/external-proof.server";
import {
  decodeListCursor,
  nextListCursorFromPage,
  resolveListPageLimit,
  type ListPageOptions,
  type ListPageResult,
} from "~/lib/list-pagination";
import type {
  AdRecord,
  CollectionItemRecord,
  CollectionRecord,
} from "~/lib/types";

interface CollectionRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionItemRow {
  id: string;
  collection_id: string;
  ad_id: string;
  note: string | null;
  ad_snapshot_json: string;
  created_at: string;
  updated_at: string;
}

export type CreateCollectionWithinLimitResult =
  | {
      status: "created";
      collection: CollectionRecord;
      current: number;
      limit: number;
    }
  | {
      status: "over_cap";
      collection: null;
      current: number;
      limit: number;
    };

const COLLECTION_LIST_COLUMNS = `
  id,
  user_id,
  name,
  description,
  created_at,
  updated_at
`;

const COLLECTION_ITEM_LIST_COLUMNS = `
  id,
  collection_id,
  ad_id,
  note,
  ad_snapshot_json,
  created_at,
  updated_at
`;

const USER_LIST_PAGE_SIZE = 500;

function toCollectionRecord(row: CollectionRow): CollectionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCollectionsPage(
  env: AppEnv,
  userId: string,
  options: ListPageOptions = {},
): Promise<ListPageResult<CollectionRecord>> {
  const limit = resolveListPageLimit(options.limit, USER_LIST_PAGE_SIZE);
  const cursor = decodeListCursor(options.cursor);
  const rows = await many<CollectionRow>(
    env,
    `
      SELECT ${COLLECTION_LIST_COLUMNS}
      FROM collection
      WHERE user_id = ?
        ${cursor ? "AND (updated_at < ? OR (updated_at = ? AND id < ?))" : ""}
      ORDER BY updated_at DESC, id DESC
      LIMIT ?
    `,
    ...(cursor
      ? [userId, cursor.sortValue, cursor.sortValue, cursor.id, limit]
      : [userId, limit]),
  );
  const items = rows.map(toCollectionRecord);
  return {
    items,
    nextCursor: nextListCursorFromPage(
      items,
      limit,
      (item) => item.updatedAt,
      (item) => item.id,
    ),
  };
}

export async function listCollections(
  env: AppEnv,
  userId: string,
  options: ListPageOptions = {},
) {
  const page = await listCollectionsPage(env, userId, options);
  return page.items;
}

export async function getCollection(env: AppEnv, collectionId: string, userId?: string) {
  const row = await one<CollectionRow>(
    env,
    `
      SELECT *
      FROM collection
      WHERE id = ? ${userId ? "AND user_id = ?" : ""}
    `,
    ...(userId ? [collectionId, userId] : [collectionId]),
  );

  return row ? toCollectionRecord(row) : null;
}

export async function createCollection(
  env: AppEnv,
  userId: string,
  input: { name: string; description?: string | null },
) {
  const id = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO collection (id, user_id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    id,
    userId,
    input.name.trim(),
    input.description?.trim() ?? null,
    timestamp,
    timestamp,
  );

  const row = await one<CollectionRow>(env, "SELECT * FROM collection WHERE id = ?", id);
  return row ? toCollectionRecord(row) : null;
}

/**
 * Create a collection without allowing a concurrent request to consume the
 * same final plan slot. The count check belongs in the INSERT ... SELECT so
 * SQLite/D1 evaluates it and the write as one atomic operation.
 */
export async function createCollectionWithinLimit(
  env: AppEnv,
  userId: string,
  input: { name: string; description?: string | null },
  planLimit: number,
): Promise<CreateCollectionWithinLimitResult> {
  const limit = Math.max(0, Math.floor(planLimit));
  const id = createId();
  const timestamp = nowIso();

  await run(
    env,
    `
      INSERT INTO collection (id, user_id, name, description, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE ? > (
        SELECT COUNT(*)
        FROM collection
        WHERE user_id = ?
      )
    `,
    id,
    userId,
    input.name.trim(),
    input.description?.trim() ?? null,
    timestamp,
    timestamp,
    limit,
    userId,
  );

  const collection = await getCollection(env, id, userId);
  const current = await countCollections(env, userId);
  if (collection) {
    return { status: "created", collection, current, limit };
  }

  return { status: "over_cap", collection: null, current, limit };
}

async function countCollections(env: AppEnv, userId: string) {
  const row = await one<{ count: number }>(
    env,
    "SELECT COUNT(*) AS count FROM collection WHERE user_id = ?",
    userId,
  );
  return Number(row?.count ?? 0);
}

export async function listCollectionItemsPage(
  env: AppEnv,
  collectionId: string,
  options: ListPageOptions = {},
): Promise<ListPageResult<CollectionItemRecord>> {
  const limit = resolveListPageLimit(options.limit, USER_LIST_PAGE_SIZE);
  const cursor = decodeListCursor(options.cursor);
  const rows = await many<CollectionItemRow>(
    env,
    `
      SELECT ${COLLECTION_ITEM_LIST_COLUMNS}
      FROM collection_item
      WHERE collection_id = ?
        ${cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    ...(cursor
      ? [collectionId, cursor.sortValue, cursor.sortValue, cursor.id, limit]
      : [collectionId, limit]),
  );

  const tagsByItemId = new Map<string, string[]>();

  if (rows.length > 0) {
    // Join through collection_item instead of expanding item ids into
    // `IN (?, ...)` — D1 caps bound parameters at 100, so collections with
    // more than 100 items would otherwise fail to load.
    const tags = await many<{ collection_item_id: string; label: string }>(
      env,
      `
        SELECT collection_item_tag.collection_item_id, tag.label
        FROM collection_item_tag
        INNER JOIN tag ON tag.id = collection_item_tag.tag_id
        INNER JOIN collection_item ON collection_item.id = collection_item_tag.collection_item_id
        WHERE collection_item.collection_id = ?
        ORDER BY tag.label ASC
      `,
      collectionId,
    );

    for (const row of tags) {
      const next = tagsByItemId.get(row.collection_item_id) ?? [];
      next.push(row.label);
      tagsByItemId.set(row.collection_item_id, next);
    }
  }

  const items = rows.map<CollectionItemRecord>((row: CollectionItemRow) => ({
    id: row.id,
    collectionId: row.collection_id,
    adId: row.ad_id,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ad: parseJson<AdRecord>(row.ad_snapshot_json, {} as AdRecord),
    tags: tagsByItemId.get(row.id) ?? [],
  }));

  return {
    items,
    nextCursor: nextListCursorFromPage(
      items,
      limit,
      (item) => item.createdAt,
      (item) => item.id,
    ),
  };
}

export async function listCollectionItems(
  env: AppEnv,
  collectionId: string,
  options: ListPageOptions = {},
) {
  if (options.limit != null || options.cursor != null) {
    const page = await listCollectionItemsPage(env, collectionId, options);
    return page.items;
  }

  // Export/share/report callers need the full board; page through D1 so a
  // collection past one page size is never silently truncated.
  const items: CollectionItemRecord[] = [];
  let cursor: string | null = null;
  do {
    const page = await listCollectionItemsPage(env, collectionId, {
      limit: USER_LIST_PAGE_SIZE,
      cursor,
    });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);

  return items;
}

export async function updateCollectionItem(
  env: AppEnv,
  userId: string,
  itemId: string,
  input: { note: string | null; tags: string[] },
) {
  const owner = await one<{ id: string }>(
    env,
    `
      SELECT collection_item.id
      FROM collection_item
      INNER JOIN collection ON collection.id = collection_item.collection_id
      WHERE collection_item.id = ? AND collection.user_id = ?
    `,
    itemId,
    userId,
  );

  if (!owner) {
    throw new Error("Collection item not found.");
  }

  const timestamp = nowIso();
  await run(
    env,
    "UPDATE collection_item SET note = ?, updated_at = ? WHERE id = ?",
    input.note?.trim() || null,
    timestamp,
    itemId,
  );

  await run(env, "DELETE FROM collection_item_tag WHERE collection_item_id = ?", itemId);
  const tagIds = await ensureTags(env, userId, input.tags);

  for (const tagId of tagIds) {
    await run(
      env,
      `
        INSERT INTO collection_item_tag (collection_item_id, tag_id)
        VALUES (?, ?)
      `,
      itemId,
      tagId,
    );
  }
}

export async function addAdToCollection(
  env: AppEnv,
  userId: string,
  collectionId: string,
  ad: AdRecord,
  note: string | null,
  tags: string[],
) {
  const collection = await one<{ id: string }>(
    env,
    "SELECT id FROM collection WHERE id = ? AND user_id = ?",
    collectionId,
    userId,
  );

  if (!collection) {
    throw new Error("Collection not found.");
  }

  // WP-10: on explicit save only — copy the creative into R2 so board
  // thumbnails outlive expiring fbcdn signatures. Failures keep the original URL.
  let adToStore: AdRecord = ad;
  try {
    const { persistCreativeThumbnailForSavedAd } = await import(
      "~/lib/creative-thumbnail.server"
    );
    const durableUrl = await persistCreativeThumbnailForSavedAd(env, ad);
    if (durableUrl && durableUrl !== ad.creativeImageUrl) {
      adToStore = { ...ad, creativeImageUrl: durableUrl };
    }
  } catch {
    adToStore = ad;
  }

  await upsertAd(env, adToStore);

  const itemId = createId();
  const timestamp = nowIso();
  await run(
    env,
    `
      INSERT INTO collection_item (
        id,
        collection_id,
        ad_id,
        note,
        ad_snapshot_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection_id, ad_id)
      DO UPDATE SET note = excluded.note,
                    ad_snapshot_json = excluded.ad_snapshot_json,
                    updated_at = excluded.updated_at
    `,
    itemId,
    collectionId,
    adToStore.metaAdId,
    note?.trim() || null,
    jsonValue(adToStore),
    timestamp,
    timestamp,
  );

  const row = await one<{ id: string }>(
    env,
    "SELECT id FROM collection_item WHERE collection_id = ? AND ad_id = ?",
    collectionId,
    adToStore.metaAdId,
  );

  if (row) {
    await updateCollectionItem(env, userId, row.id, { note, tags });
  }
}

export async function addExternalProofToCollection(
  env: AppEnv,
  userId: string,
  collectionId: string,
  input: {
    advertiser: string;
    proofUrl: string;
    channel: string;
    hook: string;
    offer?: string | null;
    cta?: string | null;
    note?: string | null;
    observedAt?: string | null;
    spend?: string | null;
    impressions?: string | null;
    reach?: string | null;
    tags?: string[];
  },
) {
  const ad = buildExternalProofAd(input);
  const tags = [...new Set([...(input.tags ?? []), ...(ad.tags ?? [])])];
  await addAdToCollection(env, userId, collectionId, ad, input.note ?? null, tags);

  return ad;
}

async function ensureTags(env: AppEnv, userId: string, labels: string[]) {
  const uniqueLabels = [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
  const ids: string[] = [];

  for (const label of uniqueLabels) {
    const existing = await one<{ id: string }>(
      env,
      "SELECT id FROM tag WHERE user_id = ? AND label = ?",
      userId,
      label,
    );

    if (existing) {
      ids.push(existing.id);
      continue;
    }

    const id = createId();
    const timestamp = nowIso();
    await run(
      env,
      `
        INSERT INTO tag (id, user_id, label, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      id,
      userId,
      label,
      timestamp,
      timestamp,
    );
    ids.push(id);
  }

  return ids;
}

export async function deleteCollection(env: AppEnv, userId: string, collectionId: string) {
  const db = ensureDb(env);
  // collection_item and collection_item_tag rows cascade.
  const result = await db
    .prepare("DELETE FROM collection WHERE id = ? AND user_id = ?")
    .bind(collectionId, userId)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}

/**
 * Rename a collection (and optionally update its description).
 * Ownership-scoped: a row that does not belong to `userId` is not modified,
 * and the caller can tell the two cases apart by the returned null.
 */
export async function updateCollection(
  env: AppEnv,
  userId: string,
  collectionId: string,
  input: { name: string; description?: string | null },
): Promise<CollectionRecord | null> {
  const name = input.name.trim();
  if (!name) {
    return null;
  }
  const description = input.description?.trim() ?? null;
  const timestamp = nowIso();
  const db = ensureDb(env);
  const result = await db
    .prepare(
      "UPDATE collection SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(name, description, timestamp, collectionId, userId)
    .run();

  if (Number(result.meta?.changes ?? 0) === 0) {
    return null;
  }
  return getCollection(env, collectionId, userId);
}

export async function deleteCollectionItem(env: AppEnv, userId: string, itemId: string) {
  const db = ensureDb(env);
  const result = await db
    .prepare(
      `
        DELETE FROM collection_item
        WHERE id = ?
          AND collection_id IN (SELECT id FROM collection WHERE user_id = ?)
      `,
    )
    .bind(itemId, userId)
    .run();

  return Number(result.meta?.changes ?? 0) > 0;
}
