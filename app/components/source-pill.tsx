import type { CSSProperties, ReactElement } from "react";

export interface SourceRow {
  key: string;
  platform: string;
  is_enabled: number | boolean;
  name?: string | null;
  degraded_reason?: string | null;
  last_good_at?: string | null;
  config_json?: string | null;
}

export interface SourceSnapshot {
  item_count: number;
  fetched_at: string;
  canary_count?: number | null;
}

export type SourcePillState = "live" | "none" | "degraded" | "disabled";

export interface SourcePillStatus {
  state: SourcePillState;
  reason: string | null;
  lastGoodAt: string | null;
}

const MONO = 'var(--mono, var(--font-mono, "IBM Plex Mono", ui-monospace, monospace))';
const INK_SOFT = "var(--ink-soft, var(--color-ink-soft, #55524a))";
const LINE = "var(--line, var(--color-line, #ddd6c6))";
const ACCENT = "var(--green, var(--color-accent, #16c47f))";
const ACCENT_INK = "var(--green-ink, var(--color-accent-ink, #064d31))";
const ACCENT_WASH = "var(--green-wash, var(--color-accent-wash, #d9f6e8))";

const LAST_GOOD_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function sourcePillStatus(
  source: SourceRow,
  snapshot: SourceSnapshot | null,
): SourcePillStatus {
  const config = sourceConfig(source.config_json);
  const configState = configString(config, "state");
  if (!source.is_enabled || configState === "disabled" || configState === "parked") {
    return { state: "disabled", reason: null, lastGoodAt: null };
  }
  const columnReason = blankToNull(source.degraded_reason);
  const configReason = configString(config, "reason");
  const lastGoodAt =
    blankToNull(source.last_good_at) ??
    configString(config, "last_good_at") ??
    configString(config, "last_good") ??
    configString(config, "since");
  if (columnReason !== null || configState === "degraded" || snapshot?.canary_count === 0) {
    return {
      state: "degraded",
      reason: columnReason ?? configReason ?? "not answering",
      lastGoodAt,
    };
  }
  if (snapshot === null || snapshot.item_count <= 0) {
    return { state: "none", reason: null, lastGoodAt };
  }
  return { state: "live", reason: null, lastGoodAt };
}

export function SourcePill({
  source,
  snapshot,
}: {
  source: SourceRow;
  snapshot: SourceSnapshot | null;
}): ReactElement | null {
  const status = sourcePillStatus(source, snapshot);
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
          — degraded{status.reason === null ? "" : `: ${status.reason}`}
          {lastGood === null ? "" : ` · last good ${lastGood}`}
        </span>
      ) : null}
    </span>
  );
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
  } catch {
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
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return LAST_GOOD_FORMAT.format(new Date(ms));
}
