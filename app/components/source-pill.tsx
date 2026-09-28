import type { CSSProperties, ReactElement } from "react";

import { readWatchConfig } from "../lib/mentions/youtube-channel";
import { shortUtc } from "../lib/short-utc";

export interface SourceRow {
  key: string;
  platform: string;
  is_enabled: number | boolean;
  name?: string | null;
  degraded_reason?: string | null;
  last_good_at?: string | null;
  config_json?: string | null;
  watch_config_json?: string | null;
}

export interface SourceSnapshot {
  item_count: number;
  fetched_at: string;
  canary_count?: number | null;
}

type SourcePillState = "live" | "none" | "degraded" | "disabled";

export interface SourcePillStatus {
  state: SourcePillState;
  reason: string | null;
  lastGoodAt: string | null;
}

const MONO = 'var(--mono, var(--font-mono, "IBM Plex Mono", ui-monospace, monospace))';
const INK_SOFT = "var(--ink-soft, var(--color-ink-soft))";
const LINE = "var(--line, var(--color-line))";
const ACCENT = "var(--green, var(--color-green))";
const ACCENT_INK = "var(--green-ink, var(--color-green-ink))";
const ACCENT_WASH = "var(--green-wash, var(--color-green-wash))";

const LIVE_WINDOW_MS = 48 * 60 * 60 * 1000;

export function sourcePillStatus(
  source: SourceRow,
  snapshot: SourceSnapshot | null,
  now: number = Date.now(),
): SourcePillStatus {
  const config = sourceConfig(source.config_json);
  const configState = configString(config, "state");
  if (!enabled(source.is_enabled) || configState === "disabled" || configState === "parked") {
    return { state: "disabled", reason: null, lastGoodAt: null };
  }
  const columnReason = blankToNull(source.degraded_reason);
  const configReason = configString(config, "reason");
  const lastGoodAt =
    blankToNull(source.last_good_at) ?? configString(config, "last_good_at");
  if (columnReason !== null || configState === "degraded" || snapshot?.canary_count === 0) {
    const reason =
      columnReason ??
      configReason ??
      (snapshot?.canary_count === 0 ? "not answering" : "no reason recorded");
    return { state: "degraded", reason, lastGoodAt };
  }
  const watchConfig = readWatchConfig(source.watch_config_json);
  if (watchConfig.status === "unreadable") {
    return { state: "degraded", reason: "watch config is unreadable", lastGoodAt: null };
  }
  if (watchConfig.degraded !== null) {
    return { state: "degraded", reason: watchConfig.degraded.reason, lastGoodAt: watchConfig.degraded.at };
  }
  const fetchedAt = snapshot === null ? null : blankToNull(snapshot.fetched_at);
  const fetchedMs = fetchedAt === null ? Number.NaN : Date.parse(fetchedAt);
  const captured = Number.isNaN(fetchedMs) ? null : fetchedAt;
  const fresh = captured !== null && now - fetchedMs <= LIVE_WINDOW_MS;
  if (snapshot === null || !fresh) {
    return { state: "degraded", reason: "no fresh data", lastGoodAt: lastGoodAt ?? captured };
  }
  if (snapshot.item_count <= 0) {
    return { state: "none", reason: null, lastGoodAt };
  }
  return { state: "live", reason: null, lastGoodAt };
}

export function SourcePill({
  source,
  snapshot,
  now,
}: {
  source: SourceRow;
  snapshot: SourceSnapshot | null;
  now?: number;
}): ReactElement | null {
  const status = sourcePillStatus(source, snapshot, now);
  if (status.state === "disabled") return null;
  const live = status.state === "live";
  const name = blankToNull(source.name) ?? blankToNull(source.platform) ?? source.key;
  const lastGood = lastGoodLabel(status.lastGoodAt);
  const style: CSSProperties = {
    display: "inline-flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: "0.45em",
    margin: 0,
    padding: "0.14em 0.55em",
    border: "1px solid",
    borderColor: live ? ACCENT : LINE,
    backgroundColor: live ? ACCENT_WASH : "transparent",
    color: live ? ACCENT_INK : INK_SOFT,
    fontFamily: MONO,
    fontSize: "0.66rem",
    lineHeight: 1.3,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    overflowWrap: "anywhere",
  };
  return (
    <span data-state={status.state} style={style}>
      <span>{name}</span>
      {status.state === "none" ? <span>— none</span> : null}
      {status.state === "degraded" ? (
        <span>
          — degraded{status.reason === null ? "" : `: ${status.reason}`} · last good{" "}
          {lastGood ?? "unknown"}
        </span>
      ) : null}
    </span>
  );
}

function enabled(value: number | boolean): boolean {
  return value === true || Number(value) === 1;
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function sourceConfig(raw: string | null | undefined): Record<string, unknown> {
  const text = blankToNull(raw);
  if (text === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    console.error(JSON.stringify({ event: "source_pill.json_parse_failed", error: String(error) }));
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function configString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" ? blankToNull(value) : null;
}

function lastGoodLabel(value: string | null): string | null {
  if (value === null) return null;
  return shortUtc(value);
}
