import { z } from "zod";

import { normaliseSubject } from "../identity/normalise";
import { socialSchema } from "../identity/social";

const CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/;

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
			degraded: LostChannelFlag | null;
			record: Record<string, unknown>;
	  };

export function isYoutubeChannelId(value: string): boolean {
	return CHANNEL_ID.test(value);
}

export function isLostYoutubeChannel(status: number, contentType: string, body: string): boolean {
	if (status === 404) return true;
	if (status !== 200) return false;
	const type = contentType.toLowerCase();
	if (type.includes("html")) return true;
	return /^\s*<!doctype html/i.test(body) || /^\s*<html[\s>]/i.test(body);
}

export function channelIdFromUrl(url: string): string | null {
	const normalised = normaliseSubject(url);
	if (!normalised.ok || normalised.subject.platform !== "youtube") return null;
	if (normalised.subject.kind !== "channel") return null;
	if (!isYoutubeChannelId(normalised.subject.registrable)) return null;
	return normalised.subject.registrable;
}

export function readWatchConfig(raw: string | null | undefined): WatchConfigRead {
	if (raw == null || raw.trim() === "") {
		return { status: "ok", channelId: null, degraded: null, record: {} };
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return { status: "unreadable" };
	}
	const record = jsonObject.safeParse(value);
	if (!record.success) return { status: "unreadable" };

	let channelId: string | null = null;
	if (Object.hasOwn(record.data, "channelId")) {
		const parsed = channelIdSchema.safeParse(record.data.channelId);
		if (!parsed.success) return { status: "unreadable" };
		channelId = parsed.data;
	}

	let degraded: LostChannelFlag | null = null;
	if (Object.hasOwn(record.data, "degraded")) {
		const parsed = degradedSchema.safeParse(record.data.degraded);
		if (!parsed.success) return { status: "unreadable" };
		degraded = { reason: parsed.data.reason, at: parsed.data.at };
	}

	return { status: "ok", channelId, degraded, record: record.data };
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

export function withChannelId(raw: string, channelId: string): string {
	const read = readWatchConfig(raw);
	if (read.status !== "ok") throw new Error("watch config_json is unreadable");
	return JSON.stringify({ ...read.record, channelId });
}

export function withResolvedChannel(raw: string, channelId: string): string {
	const read = readWatchConfig(raw);
	if (read.status !== "ok") throw new Error("watch config_json is unreadable");
	const next: Record<string, unknown> = { ...read.record, channelId };
	delete next.degraded;
	return JSON.stringify(next);
}
