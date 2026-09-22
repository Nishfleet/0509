import type { CSSProperties, ReactElement } from "react";

const emailPaint = {
  bone: "#f4f1e8",
  inkSoft: "#55524a",
  red: "#e0442c",
  green: "#16c47f",
  onGreen: "#0e0d0a",
} as const;

export const markSizes = ["lg", "md", "sm", "email"] as const;

export type MarkSize = (typeof markSizes)[number];

export interface MarkProps {
  before: string;
  after: string;
  sourceUrl: string;
  capturedAt: string;
  size: MarkSize;
  screenshotUrl?: string;
}

interface Paint {
  struck: string;
  strike: string;
  marker: string;
  onMarker: string;
  ground: string;
}

const SCREEN_FONT = {
  lg: "var(--mark-lg, clamp(1.4rem, 3.4vw, 2.5rem))",
  md: "var(--mark-md, clamp(1rem, 1.9vw, 1.45rem))",
  sm: "var(--mark-sm, 1rem)",
} as const;

const EMAIL_FONT = "22px";
const DISPLAY_FONT =
  'var(--display, var(--font-display, "Bricolage Grotesque", ui-sans-serif, sans-serif))';
const EMAIL_FONT_FAMILY = '"Bricolage Grotesque", ui-sans-serif, sans-serif';
const screenshotUnavailable = "screenshot unavailable";

export function Mark({
  before,
  after,
  sourceUrl,
  capturedAt,
  size,
  screenshotUrl,
}: MarkProps): ReactElement | null {
  const source = httpUrl(sourceUrl);
  const captured = capturedInstant(capturedAt);
  if (before.trim() === "" || after.trim() === "" || source === null || captured === null) {
    return null;
  }

  const email = size === "email";
  const colors = paint(email);
  const shot = screenshotSrc(screenshotUrl, email);
  const line: CSSProperties = {
    margin: 0,
    fontFamily: email ? EMAIL_FONT_FAMILY : DISPLAY_FONT,
    fontWeight: 800,
    fontSize: fontSize(size),
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
    overflowWrap: "anywhere",
  };

  return (
    <figure
      data-size={size}
      style={{
        margin: 0,
        color: colors.struck,
        backgroundColor: email ? colors.ground : undefined,
        padding: email ? "12px" : undefined,
      }}
    >
      {shot === null ? (
        <p style={{ margin: 0 }}>{screenshotUnavailable}</p>
      ) : (
        <img src={shot} alt={`Capture, ${capturedAt.trim()}`} width={104} height={74} />
      )}
      <p style={line}>
        <s
          style={{
            color: colors.struck,
            textDecorationLine: "line-through",
            textDecorationColor: colors.strike,
            textDecorationThickness: "0.09em",
          }}
        >
          {before.trim()}
        </s>{" "}
        <ins
          style={{
            backgroundColor: colors.marker,
            color: colors.onMarker,
            textDecoration: "none",
            padding: "0 0.14em",
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {after.trim()}
        </ins>
      </p>
      <figcaption
        style={{
          margin: 0,
          overflowWrap: "anywhere",
          fontFamily: email
            ? '"IBM Plex Mono", ui-monospace, monospace'
            : 'var(--mono, var(--font-mono, "IBM Plex Mono", ui-monospace, monospace))',
          fontSize: "0.68rem",
          letterSpacing: "0.06em",
        }}
      >
        <a href={source} style={{ color: "inherit" }}>
          {source}
        </a>
        <time dateTime={captured} style={{ marginLeft: "8px" }}>
          {capturedAt.trim()}
        </time>
      </figcaption>
    </figure>
  );
}

function fontSize(size: MarkSize): string {
  if (size === "email") return EMAIL_FONT;
  return SCREEN_FONT[size];
}

function paint(email: boolean): Paint {
  if (email) {
    return {
      struck: emailPaint.inkSoft,
      strike: emailPaint.red,
      marker: emailPaint.green,
      onMarker: emailPaint.onGreen,
      ground: emailPaint.bone,
    };
  }
  return {
    struck: "var(--ink-soft, var(--color-ink-soft))",
    strike: "var(--red, var(--color-red))",
    marker: "var(--green, var(--color-green))",
    onMarker: "var(--on-green, var(--color-on-green))",
    ground: "transparent",
  };
}

function httpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}

function capturedInstant(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function screenshotSrc(value: string | undefined, email: boolean): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    if (email) return null;
    return trimmed;
  }
  return httpUrl(trimmed);
}
