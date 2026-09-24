import { z } from "zod";

const shotSide = z.object({
  snapshotId: z.string(),
  screenshotKey: z.string().nullable(),
});

const siteChangePayload = z.object({
  page: z.object({ role: z.string(), url: z.string() }),
  before: shotSide,
  after: shotSide,
  diffKey: z.string().nullable(),
  wordsAdded: z.number().int().nonnegative(),
  wordsRemoved: z.number().int().nonnegative(),
});

export type SiteChangePayload = z.output<typeof siteChangePayload>;

function parseJson(json: string, what: string): unknown {
  try {
    return JSON.parse(json);
  } catch (err) {
    console.log(JSON.stringify({ event: "site_change.unreadable", what, error: String(err) }));
    return null;
  }
}

export function parseSiteChangePayload(json: string): SiteChangePayload | null {
  const parsed = siteChangePayload.safeParse(parseJson(json, "payload"));
  return parsed.success ? parsed.data : null;
}

const hunkFile = z.object({
  hunks: z.array(z.object({ lines: z.array(z.string()) })),
});

export function parseDiffHunks(json: string): string[][] | null {
  const parsed = hunkFile.safeParse(parseJson(json, "diff"));
  return parsed.success ? parsed.data.hunks.map((hunk) => hunk.lines) : null;
}

const PAGE_LABEL: Record<string, string> = {
  home: "homepage",
  pricing: "pricing page",
  product: "product page",
  blog: "blog",
  careers: "careers page",
  legal: "legal page",
};

export function pageLabel(role: string): string {
  return PAGE_LABEL[role] ?? "website";
}

export function changeHeadline(input: { name: string; isSelf: boolean; role: string }): string {
  const page = pageLabel(input.role);
  if (input.isSelf) return `Your ${page} changed`;
  return `${input.name} changed its ${page}`;
}

export const MARK_MAX_CHARS = 160;

function clip(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MARK_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, MARK_MAX_CHARS - 1).trimEnd()}…`;
}

export type ChangeShot = { src: string; capturedAt: string } | { missing: string };

export interface ChangeMark {
  removed: string | null;
  added: string | null;
}

function firstLine(lines: readonly string[], sign: "-" | "+"): string | null {
  const line = lines.find((candidate) => candidate.startsWith(sign) && candidate.slice(1).trim() !== "");
  return line === undefined ? null : clip(line.slice(1));
}

export function markFromHunks(hunks: readonly (readonly string[])[]): ChangeMark | null {
  const marks = hunks.map((lines) => ({ removed: firstLine(lines, "-"), added: firstLine(lines, "+") }));
  const paired = marks.find((mark) => mark.removed !== null && mark.added !== null);
  if (paired !== undefined) return paired;
  return marks.find((mark) => mark.removed !== null || mark.added !== null) ?? null;
}

function words(count: number): string {
  return count === 1 ? "1 word" : `${String(count)} words`;
}

export function wordsSentence(added: number, removed: number): string {
  if (added > 0 && removed > 0) return `${words(added)} added, ${String(removed)} removed.`;
  if (added > 0) return `${words(added)} added.`;
  if (removed > 0) return `${words(removed)} removed.`;
  return "The wording moved around.";
}

const CAPTURE_TIME = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function captureLabel(at: string): string {
  const parts = Object.fromEntries(CAPTURE_TIME.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  return `${parts.year ?? ""}-${parts.month ?? ""}-${parts.day ?? ""} ${parts.hour ?? ""}:${parts.minute ?? ""} UTC`;
}

export interface SiteChangeView {
  id: string;
  entityId: string;
  isSelf: boolean;
  headline: string;
  page: string;
  url: string;
  observedAt: string;
  capturedAt: string;
  wordsChanged: number;
  sentence: string;
  mark: ChangeMark | null;
  before: ChangeShot;
  after: ChangeShot;
}
