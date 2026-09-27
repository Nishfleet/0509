import { z } from "zod";

import { normaliseSubject } from "../identity/normalise";

const socialSchema = z.object({ platform: z.string(), url: z.string() });

const CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/;
const PAGE_CAP = 1_048_576;
const CANONICAL_CHANNEL = /https?:\/\/(?:www\.)?youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/;
const EXTERNAL_ID = /"externalId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/;
const CHANNEL_ID_KEY = /"channelId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/;

const channelIdSchema = z.string().regex(CHANNEL_ID);

const degradedSchema = z.object({
	state: z.literal("degraded"),
	reason: z.string().min(1),
	at: z.string().min(1),
});

const identitySchema = z.object({
	socials: z.array(socialSchema).optional(),
});

const jsonObject = z.record(z.string(), z.unknown());

export const LOST_CHANNEL_REASON = "we lost the channel, re-resolving";

interface LostChannelFlag {
	reason: string;
	at: string;
}

type WatchConfigRead =
	| { status: "unreadable" }
	| {
			status: "ok";
			channelId: string | null;
			pendingChannelId: string | null;
			degraded: LostChannelFlag | null;
			record: Record<string, unknown>;
	  };

export function isYoutubeChannelId(value: string): boolean {
	return CHANNEL_ID.test(value);
}

export function channelIdFromUrl(url: string): string | null {
	const normalised = normaliseSubject(url);
	if (!normalised.ok || normalised.subject.platform !== "youtube") return null;
	if (normalised.subject.kind !== "channel") return null;
	if (!isYoutubeChannelId(normalised.subject.registrable)) return null;
	return normalised.subject.registrable;
}

export function channelIdFromHtml(html: string): string | null {
	const body = html.length > PAGE_CAP ? html.slice(0, PAGE_CAP) : html;
	for (const pattern of [EXTERNAL_ID, CANONICAL_CHANNEL, CHANNEL_ID_KEY]) {
		const id = pattern.exec(body)?.[1];
		if (id !== undefined && isYoutubeChannelId(id)) return id;
	}
	return null;
}

function readChannelField(
	record: Record<string, unknown>,
	key: string,
): { ok: true; value: string | null } | { ok: false } {
	if (!Object.hasOwn(record, key)) return { ok: true, value: null };
	const parsed = channelIdSchema.safeParse(record[key]);
	if (!parsed.success) return { ok: false };
	return { ok: true, value: parsed.data };
}

export function readWatchConfig(raw: string | null | undefined): WatchConfigRead {
	if (raw == null || raw.trim() === "") {
		return { status: "ok", channelId: null, pendingChannelId: null, degraded: null, record: {} };
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		console.error(JSON.stringify({ event: "mentions.youtube_channel_json_parse_failed", error: String(error) }));
		return { status: "unreadable" };
	}
	const record = jsonObject.safeParse(value);
	if (!record.success) return { status: "unreadable" };

	const channelId = readChannelField(record.data, "channelId");
	const pendingChannelId = readChannelField(record.data, "pendingChannelId");
	if (!channelId.ok || !pendingChannelId.ok) return { status: "unreadable" };

	let degraded: LostChannelFlag | null = null;
	if (Object.hasOwn(record.data, "degraded")) {
		const parsed = degradedSchema.safeParse(record.data.degraded);
		if (!parsed.success) return { status: "unreadable" };
		degraded = { reason: parsed.data.reason, at: parsed.data.at };
	}

	return {
		status: "ok",
		channelId: channelId.value,
		pendingChannelId: pendingChannelId.value,
		degraded,
		record: record.data,
	};
}

export function youtubeUrlFromIdentity(raw: string): string | null {
	const value: unknown = JSON.parse(raw);
	const card = identitySchema.parse(value);
	for (const social of card.socials ?? []) {
		if (social.platform === "youtube" && social.url.startsWith("https://")) return social.url;
	}
	return null;
}

export function channelIdFromIdentity(raw: string): string | null {
	const url = youtubeUrlFromIdentity(raw);
	if (url === null) return null;
	return channelIdFromUrl(url);
}

export function withLostChannel(raw: string, at: string): string {
	const read = readWatchConfig(raw);
	if (read.status !== "ok") throw new Error("watch config_json is unreadable");
	if (read.degraded !== null) return raw;
	return JSON.stringify({
		...read.record,
		degraded: { state: "degraded", reason: LOST_CHANNEL_REASON, at },
	});
}

export function withResolvedChannel(raw: string, channelId: string): string {
	const read = readWatchConfig(raw);
	if (read.status !== "ok") throw new Error("watch config_json is unreadable");
	const next: Record<string, unknown> = { ...read.record, channelId };
	delete next.degraded;
	delete next.pendingChannelId;
	return JSON.stringify(next);
}

export function withPendingChannel(raw: string, pendingChannelId: string): string {
	const read = readWatchConfig(raw);
	if (read.status !== "ok") throw new Error("watch config_json is unreadable");
	return JSON.stringify({ ...read.record, pendingChannelId });
}

export function withoutPendingChannel(raw: string): string {
	const read = readWatchConfig(raw);
	if (read.status !== "ok") throw new Error("watch config_json is unreadable");
	const next: Record<string, unknown> = { ...read.record };
	delete next.pendingChannelId;
	return JSON.stringify(next);
}
