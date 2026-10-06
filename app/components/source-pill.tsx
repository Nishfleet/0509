import type { CSSProperties, ReactElement } from "react";

import { blankToNull, sourcePillStatus, type SourceRow, type SourceSnapshot } from "../lib/source-pill-status";
import { shortUtc } from "../lib/short-utc";
import { sourceName } from "../lib/source-name";
import { plainSourceReason } from "../lib/source-status-words";

const MONO = 'var(--mono, var(--font-mono, "IBM Plex Mono", ui-monospace, monospace))';
const INK_SOFT = "var(--ink-soft, var(--color-ink-soft))";
const LINE_FALLBACK = "var(--line, var(--color-line))";
const ACCENT = "var(--green, var(--color-green))";
const ACCENT_INK = "var(--green-ink, var(--color-green-ink))";
const ACCENT_WASH = "var(--green-wash, var(--color-green-wash))";

function pillStyle(live: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    columnGap: "0.45em",
    margin: 0,
    padding: "0.14em 0.55em",
    border: "1px solid",
    borderColor: live ? ACCENT : LINE_FALLBACK,
    backgroundColor: live ? ACCENT_WASH : "transparent",
    color: live ? ACCENT_INK : INK_SOFT,
    fontFamily: MONO,
    fontSize: "0.66rem",
    lineHeight: 1.3,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    overflowWrap: "anywhere",
  };
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
  const name =
    source.kind === undefined
      ? (blankToNull(source.name) ?? blankToNull(source.platform) ?? source.key)
      : sourceName(source.kind, source.platform);
  const lastGood = lastGoodLabel(status.lastGoodAt);
  return (
    <span data-state={status.state} style={pillStyle(status.state === "live")}>
      <span>{name}</span>
      {status.state === "none" ? <span>· nothing new</span> : null}
      {status.state === "degraded" ? (
        <span>
          · {plainSourceReason(status.reason)}
          {lastGood === null ? "" : ` · last updated ${lastGood}`}
        </span>
      ) : null}
    </span>
  );
}

function lastGoodLabel(value: string | null): string | null {
  if (value === null) return null;
  return shortUtc(value);
}
