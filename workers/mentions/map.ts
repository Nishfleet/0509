import type { z } from "zod";
import type { mentionItemSchema } from "../sources/mentions/types";

export type MentionItem = z.infer<typeof mentionItemSchema> & {
	author?: string | null;
	publisher?: string | null;
	engagement?: Record<string, number> | null;
};

export interface SignalRowContext {
	workspaceId: string;
	entityId: string;
	sourceId: string;
	watchId: string | null;
	snapshotId: string | null;
	observedAt: string;
}

export interface SignalRow {
	workspace_id: string;
	entity_id: string;
	source_id: string;
	watch_id: string | null;
	snapshot_id: string | null;
	kind: "mention";
	title: string;
	canonical_url: string;
	url_hash: string;
	dedup_key: string;
	published_at: string | null;
	observed_at: string;
	last_seen_at: string;
	author: string | null;
	engagement_json: string | null;
	payload_json: string;
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export async function toSignalRow(
	item: MentionItem,
	ctx: SignalRowContext,
): Promise<SignalRow> {
	const payload = item.publisher ? { publisher: item.publisher } : {};
	return {
		workspace_id: ctx.workspaceId,
		entity_id: ctx.entityId,
		source_id: ctx.sourceId,
		watch_id: ctx.watchId,
		snapshot_id: ctx.snapshotId,
		kind: "mention",
		title: item.title,
		canonical_url: item.url,
		url_hash: await sha256Hex(item.url),
		dedup_key: item.dedupKey,
		published_at: item.publishedAt,
		observed_at: ctx.observedAt,
		last_seen_at: ctx.observedAt,
		author: item.author ?? null,
		engagement_json: item.engagement ? JSON.stringify(item.engagement) : null,
		payload_json: JSON.stringify(payload),
	};
}
