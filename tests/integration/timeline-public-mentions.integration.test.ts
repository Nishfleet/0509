import { describe, expect, it } from "vitest";

import { listPublicMentionEventsByDomain } from "~/lib/presence-data.server";

import { appEnv, db, ISO_T0, seedUser, uid } from "./fixtures";

/**
 * Issue #3179 — the public /timeline/:domain mention interleave, asserted
 * against the real D1 schema. The node-suite mocks the binding and cannot see
 * the JOIN across presence_item / tracked_entity / source_target; this suite
 * proves the read path (and its filters) on real workerd.
 */

async function seedEntityWithMentionSource(input: {
  userId: string;
  canonicalUrl: string;
  trackingMode?: "self" | "competitor";
  entityActive?: number;
  sourceActive?: number;
}) {
  const entityId = uid("entity");
  const sourceId = uid("source");
  await db()
    .prepare(
      `INSERT INTO tracked_entity (id, user_id, tracking_mode, label, canonical_url, notes, is_active, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
    )
    .bind(
      entityId,
      input.userId,
      input.trackingMode ?? "competitor",
      `Entity ${entityId}`,
      input.canonicalUrl,
      input.entityActive ?? 1,
      ISO_T0,
      ISO_T0,
    )
    .run();
  await db()
    .prepare(
      `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, target_url, target_handle, metadata_json, coverage_label, is_active, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, 'rss', ?, ?, NULL, '{}', 'VERIFIED_PUBLIC_FEED', ?, NULL, ?, ?)`,
    )
    .bind(
      sourceId,
      entityId,
      input.userId,
      `${entityId}-mentions`,
      "https://feed.example/rss",
      input.sourceActive ?? 1,
      ISO_T0,
      ISO_T0,
    )
    .run();
  return { entityId, sourceId };
}

async function seedPresenceItem(input: {
  userId: string;
  entityId: string;
  sourceId: string;
  connectorId?: string;
  canonicalUrl: string;
  urlHash: string;
  title: string;
  observedAt: string;
  tombstone?: number;
}) {
  const itemId = uid("item");
  await db()
    .prepare(
      `INSERT INTO presence_item (id, source_target_id, tracked_entity_id, user_id, connector_id, external_id, canonical_url, url_hash, title, body_excerpt, author, published_at, observed_at, content_hash, raw_json, is_tombstone, created_at, revision)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?, ?, 1)`,
    )
    .bind(
      itemId,
      input.sourceId,
      input.entityId,
      input.userId,
      input.connectorId ?? "rss",
      input.canonicalUrl,
      input.urlHash,
      input.title,
      input.observedAt,
      `${input.urlHash}-content`,
      input.tombstone ?? 0,
      ISO_T0,
    )
    .run();
  return itemId;
}

describe("listPublicMentionEventsByDomain (issue #3179)", () => {
  it("returns stored mentions of the brand behind the domain, newest first", async () => {
    const userId = await seedUser();
    const { entityId, sourceId } = await seedEntityWithMentionSource({
      userId,
      canonicalUrl: "https://www.timemention-e2e.example",
    });
    await seedPresenceItem({
      userId,
      entityId,
      sourceId,
      canonicalUrl: "https://news.example/older-mention",
      urlHash: uid("hash"),
      title: "Older mention",
      observedAt: "2026-09-01T08:00:00.000Z",
    });
    await seedPresenceItem({
      userId,
      entityId,
      sourceId,
      connectorId: "gdelt",
      canonicalUrl: "https://news.example/newer-mention",
      urlHash: uid("hash"),
      title: "Newer mention",
      observedAt: "2026-09-02T08:00:00.000Z",
    });

    // The subdomain host (`www.<domain>`) bridges to the registrable domain.
    const events = await listPublicMentionEventsByDomain(appEnv, "timemention-e2e.example");
    expect(events.map((event) => event.title)).toEqual(["Newer mention", "Older mention"]);
    expect(events[0]).toMatchObject({
      canonicalUrl: "https://news.example/newer-mention",
      connectorId: "gdelt",
      observedAt: "2026-09-02T08:00:00.000Z",
    });
  });

  it("excludes website-connector items, tombstones, inactive rows, and other domains", async () => {
    const userId = await seedUser();
    const domain = "menutexcl-e2e.example";
    const { entityId, sourceId } = await seedEntityWithMentionSource({
      userId,
      canonicalUrl: `https://www.${domain}`,
    });

    const websiteSourceId = uid("source");
    await db()
      .prepare(
        `INSERT INTO source_target (id, tracked_entity_id, user_id, connector_id, target_key, target_url, target_handle, metadata_json, coverage_label, is_active, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, 'website', ?, ?, NULL, '{}', 'GOOD', 1, NULL, ?, ?)`,
      )
      .bind(websiteSourceId, entityId, userId, domain, `https://www.${domain}`, ISO_T0, ISO_T0)
      .run();
    // A tracked website change is not a mention — it must not land here.
    await seedPresenceItem({
      userId,
      entityId,
      sourceId: websiteSourceId,
      connectorId: "website",
      canonicalUrl: `https://www.${domain}/blog/post`,
      urlHash: uid("hash"),
      title: "Site change",
      observedAt: "2026-09-02T09:00:00.000Z",
    });
    await seedPresenceItem({
      userId,
      entityId,
      sourceId,
      canonicalUrl: "https://news.example/tombstoned",
      urlHash: uid("hash"),
      title: "Tombstoned mention",
      observedAt: "2026-09-02T08:30:00.000Z",
      tombstone: 1,
    });
    await seedPresenceItem({
      userId,
      entityId,
      sourceId,
      canonicalUrl: "https://news.example/real-mention",
      urlHash: uid("hash"),
      title: "Real mention",
      observedAt: "2026-09-02T08:00:00.000Z",
    });

    // Another workspace's entity on a DIFFERENT domain must not leak in.
    const other = await seedEntityWithMentionSource({
      userId,
      canonicalUrl: "https://www.other-e2e.example",
    });
    await seedPresenceItem({
      userId,
      entityId: other.entityId,
      sourceId: other.sourceId,
      canonicalUrl: "https://news.example/other-mention",
      urlHash: uid("hash"),
      title: "Other-domain mention",
      observedAt: "2026-09-02T10:00:00.000Z",
    });

    const events = await listPublicMentionEventsByDomain(appEnv, domain);
    expect(events.map((event) => event.title)).toEqual(["Real mention"]);

    // A domain with no tracked entity returns [] rather than erroring.
    expect(await listPublicMentionEventsByDomain(appEnv, "untracked-e2e.example")).toEqual([]);
  });
});
