import { NO_CHANNEL_REASON } from "./channel-reasons";

const CHANNEL_ID = /^UC[0-9A-Za-z_-]{22}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

export interface LostChannelFlag {
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

function readChannelField(
  record: Record<string, unknown>,
  key: string,
): { ok: true; value: string | null } | { ok: false } {
  if (!Object.hasOwn(record, key)) return { ok: true, value: null };
  const held = record[key];
  if (typeof held !== "string" || !CHANNEL_ID.test(held)) return { ok: false };
  return { ok: true, value: held };
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
  if (!isRecord(value)) return { status: "unreadable" };

  const channelId = readChannelField(value, "channelId");
  const pendingChannelId = readChannelField(value, "pendingChannelId");
  if (!channelId.ok || !pendingChannelId.ok) return { status: "unreadable" };

  const flags = readFlags(value);
  if (flags === null) return { status: "unreadable" };

  return {
    status: "ok",
    channelId: channelId.value,
    pendingChannelId: pendingChannelId.value,
    degraded: flags.lostChannel ?? flags.noChannel,
    noChannel: flags.noChannel,
    lostChannel: flags.lostChannel,
    record: value,
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
  const held = record[key];
  if (!isRecord(held) || held.state !== "degraded" || !isText(held.reason) || !isText(held.at)) return { ok: false };
  return { ok: true, flag: { reason: held.reason, at: held.at } };
}
