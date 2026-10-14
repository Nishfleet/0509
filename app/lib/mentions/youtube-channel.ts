import { z } from "zod";

import { normaliseSubject } from "../identity/normalise";
import { LOST_CHANNEL_REASON, NO_CHANNEL_REASON } from "./channel-reasons";
import type { LostChannelFlag } from "./watch-config";
import { isYoutubeChannelId, readWatchConfig } from "./watch-config";

const socialSchema = z.object({ platform: z.string(), url: z.string() });

const PAGE_CAP = 1_048_576;
const CANONICAL_CHANNEL = /https?:\/\/(?:www\.)?youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/;
const EXTERNAL_ID = /"externalId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/;
const CHANNEL_ID_KEY = /"channelId"\s*:\s*"(UC[0-9A-Za-z_-]{22})"/;

const identitySchema = z.object({
  socials: z.array(socialSchema).optional(),
  socialsReadAt: z.string().nullish(),
});

export { isYoutubeChannelId, LOST_CHANNEL_REASON, NO_CHANNEL_REASON, readWatchConfig };

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

const RESERVED_YOUTUBE_PATHS = new Set([
  "about",
  "c",
  "channel",
  "signin",
  "trending",
  "user",
  "account",
  "attribution_link",
  "embed",
  "feed",
  "gaming",
  "hashtag",
  "howyoutubeworks",
  "kids",
  "live",
  "music",
  "playlist",
  "podcasts",
  "post",
  "premium",
  "redirect",
  "results",
  "shorts",
  "t",
  "tv",
  "watch",
  "yt",
]);

const BARE_YOUTUBE_NAME = /^https?:\/\/(?:www\.|m\.)?youtube\.com\/([^/?#]+)\/?(?:[?#].*)?$/i;

export function youtubePageUrl(href: string): string | null {
  const normalised = normaliseSubject(href);
  if (normalised.ok) {
    const { platform, url } = normalised.subject;
    return platform === "youtube" && url?.startsWith("https://www.youtube.com/") ? url : null;
  }
  const name = BARE_YOUTUBE_NAME.exec(href)?.[1];
  if (name === undefined || RESERVED_YOUTUBE_PATHS.has(name.toLowerCase())) return null;
  return `https://www.youtube.com/${name}`;
}

export function youtubeUrlFromIdentity(raw: string): string | null {
  const value: unknown = JSON.parse(raw);
  const card = identitySchema.parse(value);
  for (const social of card.socials ?? []) {
    if (social.platform === "youtube" && /^https?:\/\//.test(social.url)) return social.url;
  }
  return null;
}

export function identityHasYoutubeUrl(raw: string): boolean {
  const value: unknown = JSON.parse(raw);
  const card = identitySchema.parse(value);
  return (card.socials ?? []).some((social) => youtubePageUrl(social.url) !== null);
}

export function identitySocialsUnread(raw: string): boolean {
  const value: unknown = JSON.parse(raw);
  const card = identitySchema.parse(value);
  return card.socialsReadAt == null && (card.socials ?? []).length === 0;
}

export function channelIdFromIdentity(raw: string): string | null {
  const url = youtubeUrlFromIdentity(raw);
  if (url === null) return null;
  return channelIdFromUrl(url);
}

function withFlags(
  record: Record<string, unknown>,
  lostChannel: LostChannelFlag | null,
  noChannel: LostChannelFlag | null,
): string {
  const next: Record<string, unknown> = { ...record };
  delete next.degraded;
  delete next.noChannel;
  return JSON.stringify({
    ...next,
    ...(lostChannel === null ? {} : { degraded: { state: "degraded", ...lostChannel } }),
    ...(noChannel === null ? {} : { noChannel: { state: "degraded", ...noChannel } }),
  });
}

export function withLostChannel(raw: string, at: string): string {
  const read = readWatchConfig(raw);
  if (read.status !== "ok") throw new Error("watch config_json is unreadable");
  if (read.lostChannel !== null) return raw;
  const record: Record<string, unknown> = { ...read.record };
  delete record.feedError;
  return withFlags(record, { reason: LOST_CHANNEL_REASON, at }, read.noChannel);
}

export function withNoChannel(raw: string, at: string): string {
  const read = readWatchConfig(raw);
  if (read.status !== "ok") throw new Error("watch config_json is unreadable");
  if (read.noChannel !== null) return raw;
  const record: Record<string, unknown> = { ...read.record };
  delete record.pageMiss;
  return withFlags(record, read.lostChannel, { reason: NO_CHANNEL_REASON, at });
}

export function withoutLostChannel(raw: string): string {
  const read = readWatchConfig(raw);
  if (read.status !== "ok") throw new Error("watch config_json is unreadable");
  if (read.lostChannel === null) return raw;
  return withFlags(read.record, null, read.noChannel);
}

export function withoutNoChannel(raw: string): string {
  const read = readWatchConfig(raw);
  if (read.status !== "ok") throw new Error("watch config_json is unreadable");
  if (read.noChannel === null) return raw;
  return withFlags(read.record, read.lostChannel, null);
}

export function withResolvedChannel(raw: string, channelId: string): string {
  const read = readWatchConfig(raw);
  if (read.status !== "ok") throw new Error("watch config_json is unreadable");
  const next: Record<string, unknown> = { ...read.record, channelId };
  delete next.degraded;
  delete next.noChannel;
  delete next.pendingChannelId;
  delete next.pageMiss;
  delete next.feedError;
  return JSON.stringify(next);
}

export function withPageMiss(raw: string, reason: string, at: string): string {
  const read = readWatchConfig(raw);
  if (read.status !== "ok") throw new Error("watch config_json is unreadable");
  const held = read.record.pageMiss;
  if (typeof held === "object" && held !== null && "reason" in held && held.reason === reason) return raw;
  return JSON.stringify({ ...read.record, pageMiss: { reason, at } });
}

export function withFeedError(raw: string, status: number, at: string): string {
  const read = readWatchConfig(raw);
  if (read.status !== "ok") throw new Error("watch config_json is unreadable");
  return JSON.stringify({ ...read.record, feedError: { status, at } });
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
