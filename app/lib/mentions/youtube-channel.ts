import { z } from "zod";

import { normaliseSubject } from "../identity/normalise";
import { LOST_CHANNEL_REASON, NO_CHANNEL_REASON } from "./channel-reasons";

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

export { LOST_CHANNEL_REASON, NO_CHANNEL_REASON };

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
      noChannel: LostChannelFlag | null;
      lostChannel: LostChannelFlag | null;
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
    return {
      status: "ok",
      channelId: null,
      pendingChannelId: null,
      degraded: null,
      noChannel: null,
      lostChannel: null,
      record: {},
    };
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

  const flags = readFlags(record.data);
  if (flags === null) return { status: "unreadable" };

  return {
    status: "ok",
    channelId: channelId.value,
    pendingChannelId: pendingChannelId.value,
    degraded: flags.lostChannel ?? flags.noChannel,
    noChannel: flags.noChannel,
    lostChannel: flags.lostChannel,
    record: record.data,
  };
}

function readFlags(
  record: Record<string, unknown>,
): { noChannel: LostChannelFlag | null; lostChannel: LostChannelFlag | null } | null {
  const legacy = readFlagSlot(record, "degraded");
  const dedicated = readFlagSlot(record, "noChannel");
  if (!legacy.ok || !dedicated.ok) return null;
  const legacyIsNoChannel = legacy.flag?.reason === NO_CHANNEL_REASON;
  return {
    lostChannel: legacyIsNoChannel ? null : legacy.flag,
    noChannel: dedicated.flag ?? (legacyIsNoChannel ? legacy.flag : null),
  };
}

function readFlagSlot(
  record: Record<string, unknown>,
  key: string,
): { ok: true; flag: LostChannelFlag | null } | { ok: false } {
  if (!Object.hasOwn(record, key)) return { ok: true, flag: null };
  const parsed = degradedSchema.safeParse(record[key]);
  if (!parsed.success) return { ok: false };
  return { ok: true, flag: { reason: parsed.data.reason, at: parsed.data.at } };
}

export function youtubeUrlFromIdentity(raw: string): string | null {
  const value: unknown = JSON.parse(raw);
  const card = identitySchema.parse(value);
  for (const social of card.socials ?? []) {
    if (social.platform === "youtube" && social.url.startsWith("https://")) return social.url;
  }
  return null;
}

export function identityHasYoutubeUrl(raw: string): boolean {
  const value: unknown = JSON.parse(raw);
  const card = identitySchema.parse(value);
  return (card.socials ?? []).some((social) => {
    const normalised = normaliseSubject(social.url);
    return normalised.ok && normalised.subject.platform === "youtube";
  });
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
  return withFlags(read.record, { reason: LOST_CHANNEL_REASON, at }, read.noChannel);
}

export function withNoChannel(raw: string, at: string): string {
  const read = readWatchConfig(raw);
  if (read.status !== "ok") throw new Error("watch config_json is unreadable");
  if (read.noChannel !== null) return raw;
  return withFlags(read.record, read.lostChannel, { reason: NO_CHANNEL_REASON, at });
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
