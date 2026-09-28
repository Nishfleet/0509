import { describe, expect, it } from "vitest";
import { mentionItemSchema } from "../../workers/sources/mentions/types";
import type { MentionItem } from "../../workers/mentions/map";
import { storedDedupKey, toSignalRow } from "../../workers/mentions/map";

const URL_A = "https://example.com/mentions/a";
const URL_B = "https://example.com/mentions/b";
const SHA256_A = "23addbac5ad2a22484bd95cf731c9fe9014f57c05a869f9b292be47cf95ab3f4";

const CTX = {
	workspaceId: "ws_1",
	entityId: "ent_1",
	sourceId: "src_1",
	watchId: null,
	snapshotId: null,
	observedAt: "2026-09-23T04:02:19Z",
};

const ITEM: MentionItem = {
	dedupKey: "a",
	url: URL_A,
	title: "t",
	publishedAt: "2026-09-23T03:00:00Z",
	author: "alice",
};

describe("toSignalRow", () => {
	it("kind is the literal 'mention'", async () => {
		const row = await toSignalRow(ITEM, CTX);
		expect(row.kind).toBe("mention");
	});

	it("url_hash is the hex SHA-256 of canonical_url and changes when canonical_url changes", async () => {
		const a = await toSignalRow(ITEM, CTX);
		const b = await toSignalRow({ ...ITEM, url: URL_B }, CTX);
		expect(a.canonical_url).toBe(URL_A);
		expect(b.canonical_url).toBe(URL_B);
		expect(a.url_hash).toBe(SHA256_A);
		expect(b.url_hash).not.toBe(SHA256_A);
		expect(a.url_hash).not.toBe(b.url_hash);
		expect(a.url_hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("maps a real adapter item parsed by mentionItemSchema, with no renamed field", async () => {
		const adapterItem = mentionItemSchema.parse({
			dedupKey: "a",
			url: URL_A,
			title: "t",
			publishedAt: "2026-09-23T03:00:00Z",
		});
		const row = await toSignalRow(adapterItem, CTX);
		expect(row.canonical_url).toBe(URL_A);
		expect(row.url_hash).toBe(SHA256_A);
		expect(row.dedup_key).toBe("a");
		expect(row.author).toBeNull();
	});

	it("null publishedAt stays null in published_at", async () => {
		const row = await toSignalRow({ ...ITEM, publishedAt: null }, CTX);
		expect(row.published_at).toBeNull();
	});

	it("payload_json records publisher only when present", async () => {
		const withPublisher = await toSignalRow(
			{ ...ITEM, publisher: "Example News" },
			CTX,
		);
		expect(JSON.parse(withPublisher.payload_json)).toEqual({
			publisher: "Example News",
		});

		const withoutPublisher = await toSignalRow(ITEM, CTX);
		expect(JSON.parse(withoutPublisher.payload_json)).toEqual({});
	});

	it("engagement_json is the JSON of item.engagement when present, otherwise null", async () => {
		const withEngagement = await toSignalRow(
			{ ...ITEM, engagement: { points: 12, replies: 3 } },
			CTX,
		);
		const engagementJson = withEngagement.engagement_json;
		if (engagementJson === null) throw new Error("expected engagement_json to be set");
		expect(JSON.parse(engagementJson)).toEqual({
			points: 12,
			replies: 3,
		});

		const withoutEngagement = await toSignalRow(ITEM, CTX);
		expect(withoutEngagement.engagement_json).toBeNull();
	});

	it("passes context ids through and pins observed_at / last_seen_at from context", async () => {
		const row = await toSignalRow(ITEM, {
			...CTX,
			workspaceId: "ws_2",
			entityId: "ent_2",
			sourceId: "src_2",
			watchId: "watch_x",
			snapshotId: "snap_x",
			observedAt: "2026-09-23T05:00:00Z",
		});
		expect(row.workspace_id).toBe("ws_2");
		expect(row.entity_id).toBe("ent_2");
		expect(row.source_id).toBe("src_2");
		expect(row.watch_id).toBe("watch_x");
		expect(row.snapshot_id).toBe("snap_x");
		expect(row.observed_at).toBe("2026-09-23T05:00:00Z");
		expect(row.last_seen_at).toBe("2026-09-23T05:00:00Z");
	});

	it("title is carried through and dedup_key is the item's dedupKey", async () => {
		const row = await toSignalRow(
			{ ...ITEM, dedupKey: "abc-123", title: "Gymshark launches X" },
			CTX,
		);
		expect(row.title).toBe("Gymshark launches X");
		expect(row.dedup_key).toBe("abc-123");
	});

	it("stores the entity-prefixed key without changing the adapter dedup key", async () => {
		const row = await toSignalRow({ ...ITEM, dedupKey: "49807834" }, CTX);
		expect(row.dedup_key).toBe("49807834");
		expect(storedDedupKey(CTX.entityId, row.dedup_key)).toBe("ent_1:49807834");
	});

	it("maps a GDELT-shaped item: publisher in payload, article url canonical, null published_at stays null", async () => {
		const item: MentionItem = {
			dedupKey: "https://example-news.com/gymshark",
			url: "https://example-news.com/gymshark",
			title: "Gymshark opens a store",
			publishedAt: null,
			publisher: "example-news.com",
		};
		const row = await toSignalRow(item, CTX);
		expect(row.kind).toBe("mention");
		expect(row.canonical_url).toBe("https://example-news.com/gymshark");
		expect(row.published_at).toBeNull();
		expect(row.published_at).not.toBe(CTX.observedAt);
		expect(row.author).toBeNull();
		expect(JSON.parse(row.payload_json)).toEqual({ publisher: "example-news.com" });
		expect(storedDedupKey("ent_gdelt", row.dedup_key)).toBe(
			"ent_gdelt:https://example-news.com/gymshark",
		);
	});

	it("maps an HN-shaped item: objectID is the adapter dedup key and there is no publisher", async () => {
		const item: MentionItem = {
			dedupKey: "49807834",
			url: "https://github.com/romshark/datapages/releases/tag/v0.10.0",
			title: "Datapages v0.10.0 Beta Release",
			publishedAt: "2026-09-22T20:46:13Z",
		};
		const row = await toSignalRow(item, CTX);
		expect(row.dedup_key).toBe("49807834");
		expect(row.canonical_url).toBe(item.url);
		expect(row.published_at).toBe("2026-09-22T20:46:13Z");
		expect(JSON.parse(row.payload_json)).toEqual({});
		expect(storedDedupKey("ent_hn", row.dedup_key)).toBe("ent_hn:49807834");
	});

	it("maps a Medium-shaped item: canonical_url is the guid, never the tracking link", async () => {
		const guid = "https://medium.com/p/abc123";
		const item: MentionItem = {
			dedupKey: guid,
			url: guid,
			title: "A post",
			publishedAt: "2026-09-24T12:00:00Z",
		};
		const row = await toSignalRow(item, CTX);
		expect(row.canonical_url).toBe(guid);
		expect(row.canonical_url).not.toContain("?source=");
		expect(row.dedup_key).toBe(guid);
		expect(storedDedupKey("ent_med", row.dedup_key)).toBe(`ent_med:${guid}`);
	});
});
