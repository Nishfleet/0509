const CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/;
const EXTERNAL_ID = /"externalId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/;
const CANONICAL_CHANNEL = /https?:\/\/(?:www\.)?youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/;

export const LOST_CHANNEL_REASON = "we lost the channel, re-resolving";

export function isYoutubeChannelId(value: string): boolean {
	return CHANNEL_ID.test(value);
}

export function isLostYoutubeChannel(status: number, contentType: string, body: string): boolean {
	if (status === 404) return true;
	const type = contentType.toLowerCase();
	if (type.includes("html")) return true;
	return /^\s*<!doctype html/i.test(body) || /^\s*<html[\s>]/i.test(body);
}

export function channelIdFromUrl(url: string): string | null {
	if (!URL.canParse(url)) return null;
	const parts = new URL(url).pathname.split("/").filter((part) => part.length > 0);
	const id = parts[0] === "channel" ? parts[1] : undefined;
	if (id === undefined || !isYoutubeChannelId(id)) return null;
	return id;
}

export function channelIdFromHtml(html: string): string | null {
	const external = EXTERNAL_ID.exec(html);
	if (external?.[1] !== undefined && isYoutubeChannelId(external[1])) return external[1];
	const canonical = CANONICAL_CHANNEL.exec(html);
	if (canonical?.[1] !== undefined && isYoutubeChannelId(canonical[1])) return canonical[1];
	return null;
}

function objectRecord(raw: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(raw);
		if (value !== null && typeof value === "object" && !Array.isArray(value)) return { ...value };
	} catch (error) {
		console.error(
			JSON.stringify({
				event: "youtube.watch_config_unreadable",
				message: error instanceof Error ? error.message : String(error),
			}),
		);
	}
	return {};
}

export function youtubeUrlFromIdentity(raw: string): string | null {
	const socials = objectRecord(raw).socials;
	if (!Array.isArray(socials)) return null;
	for (const item of socials) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
		const platform = (item as { platform?: unknown }).platform;
		const url = (item as { url?: unknown }).url;
		if (platform === "youtube" && typeof url === "string" && url.startsWith("https://")) return url;
	}
	return null;
}

export async function resolveYoutubeChannelId(
	identityJson: string,
	fetchPage: (url: string) => Promise<Response>,
): Promise<string | null> {
	const url = youtubeUrlFromIdentity(identityJson);
	if (url === null) return null;
	const fromUrl = channelIdFromUrl(url);
	if (fromUrl !== null) return fromUrl;
	const response = await fetchPage(url);
	if (!response.ok) return null;
	return channelIdFromHtml(await response.text());
}

interface LostChannelFlag {
	reason: string;
	at: string;
}

export function lostChannelFlag(raw: string | null | undefined): LostChannelFlag | null {
	if (raw === null || raw === undefined || raw.trim() === "") return null;
	const degraded = objectRecord(raw).degraded;
	if (degraded === null || typeof degraded !== "object" || Array.isArray(degraded)) return null;
	const state = (degraded as { state?: unknown }).state;
	const reason = (degraded as { reason?: unknown }).reason;
	const at = (degraded as { at?: unknown }).at;
	if (state !== "degraded" || typeof reason !== "string" || reason.length === 0) return null;
	if (typeof at !== "string" || at.length === 0) return null;
	return { reason, at };
}

export function channelIdFromConfig(raw: string): string | null {
	const value = objectRecord(raw).channelId;
	return typeof value === "string" && isYoutubeChannelId(value) ? value : null;
}

export function withLostChannel(raw: string, at: string): string {
	if (lostChannelFlag(raw) !== null) return raw;
	const record = objectRecord(raw);
	record.degraded = { state: "degraded", reason: LOST_CHANNEL_REASON, at };
	return JSON.stringify(record);
}

export function withResolvedChannel(raw: string, channelId: string): string {
	const record = objectRecord(raw);
	record.channelId = channelId;
	delete record.degraded;
	return JSON.stringify(record);
}
