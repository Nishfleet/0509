import { findStartedRunningLine } from "~/lib/meta-ad-dates";

export interface ExtractedAdCard {
  libraryId: string;
  advertiser: string | null;
  body: string | null;
  previewHeadline: string | null;
  previewSubhead: string | null;
  cta: string | null;
  adSnapshotUrl: string | null;
  landingPageUrl: string | null;
  platforms: string[];
  active: boolean;
  /** Raw "Started running on <date>" card line; parsed server-side into firstSeenAt. */
  startedRunning?: string | null;
  /** First creative CDN image (fbcdn/scontent) found on the card, if any. */
  imageUrl?: string | null;
  /** True when a <video> element (or poster) was present on the card. */
  hasVideo?: boolean;
}

export interface RenderedHtmlPayload {
  cards: ExtractedAdCard[];
  loginWall: boolean;
  noResults: boolean;
  rateLimited: boolean;
}

/** Parse Browserless/Quick Actions rendered HTML without depending on a DOM runtime. */
export function parseRenderedMetaLibraryHtml(content: string): RenderedHtmlPayload {
  const visibleText = stripHtmlPreservingLines(content);
  const text = visibleText.toLowerCase();
  const cards: ExtractedAdCard[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  const adAnchorMatches = Array.from(content.matchAll(anchorRegex)).filter((match) => {
    const href = decodeHtmlEntity(match[2] ?? "");
    return /\/ads\/library\/\?/.test(href) || /facebook\.com\/ads\/library\/\?/.test(href);
  });
  const cardBlockStarts = buildRenderedCardBlockStarts(content, adAnchorMatches);
  const renderedCardBoundaries = buildRenderedCardBoundaries(content);

  for (const match of adAnchorMatches) {
    const href = decodeHtmlEntity(match[2] ?? "");
    const idMatch = href.match(/[?&](?:amp;)?id=(\d+)/);
    const libraryId = idMatch?.[1];
    if (!libraryId || seen.has(libraryId)) {
      continue;
    }
    seen.add(libraryId);

    const anchorStart = match.index ?? 0;
    const renderedCardBoundary = findRenderedCardBoundary(renderedCardBoundaries, anchorStart);
    const contextHtml = renderedCardBoundary
      ? content.slice(renderedCardBoundary.start, renderedCardBoundary.end)
      : sliceRenderedCardBlock(content, anchorStart, libraryId, cardBlockStarts);
    const contextLineText = stripHtmlPreservingLines(contextHtml);
    const body = stripHtml(contextHtml) || stripHtml(match[3] ?? "");
    const landingPageUrl = extractExternalLink(contextHtml);
    const media = extractCreativeMediaFromHtml(contextHtml);

    cards.push({
      libraryId,
      advertiser: null,
      body,
      previewHeadline: stripHtml(match[3] ?? "") || null,
      previewSubhead: null,
      cta: inferCta(body),
      adSnapshotUrl: absolutizeMetaAdUrl(href),
      landingPageUrl,
      platforms: inferPlatforms(body),
      active: !hasStandaloneInactiveLine(contextLineText),
      startedRunning: findStartedRunningLine(contextLineText),
      imageUrl: media.imageUrl,
      hasVideo: media.hasVideo,
    });
  }

  return {
    cards: cards.length > 0 ? cards : extractTextCardsFromVisibleText(visibleText),
    loginWall:
      /log in|login|sign in|sign into/.test(text) && text.includes("facebook"),
    noResults: hasNoResultsSignal(visibleText),
    rateLimited:
      text.includes("rate limit") ||
      text.includes("too many requests") ||
      text.includes("try again later"),
  };
}

type RenderedCardBlockStart = { libraryId: string; start: number };

/** Keep rendered-HTML fallback extraction inside one deterministic Library ID block. */
function buildRenderedCardBlockStarts(
  content: string,
  adAnchorMatches: RegExpMatchArray[],
): RenderedCardBlockStart[] {
  const starts = new Map<string, number>();

  for (const match of adAnchorMatches) {
    const href = decodeHtmlEntity(match[2] ?? "");
    const libraryId = href.match(/[?&](?:amp;)?id=(\d+)/)?.[1];
    if (!libraryId || starts.has(libraryId)) {
      continue;
    }
    starts.set(libraryId, match.index ?? 0);
  }

  const libraryIdLineRegex = /Library\s+ID:\s*(\d+)/gi;
  for (const match of content.matchAll(libraryIdLineRegex)) {
    const libraryId = match[1];
    if (!libraryId) {
      continue;
    }
    const libraryIdStart = match.index ?? 0;
    // Meta can place the card status on its own line immediately before the
    // Library ID. Keep that status with this card so the preceding card does
    // not inherit it when slicing at the next Library ID.
    const start = findStandaloneStatusImmediatelyBefore(content, libraryIdStart) ?? libraryIdStart;
    const current = starts.get(libraryId);
    starts.set(libraryId, current === undefined ? start : Math.min(current, start));
  }

  return [...starts]
    .map(([libraryId, start]) => ({ libraryId, start }))
    .sort((a, b) => a.start - b.start);
}

function findStandaloneStatusImmediatelyBefore(content: string, beforeIndex: number) {
  const prefix = content.slice(0, beforeIndex);
  const statusRegex =
    /(?:^|>|\r?\n)(?:\s|&nbsp;)*(Active|Inactive)(?:\s|&nbsp;)*(?=<|$|\r?\n)/gi;
  let statusStart: number | null = null;

  for (const match of prefix.matchAll(statusRegex)) {
    const matched = match[0];
    const status = match[1];
    if (!status) {
      continue;
    }

    const statusOffset = matched.toLowerCase().lastIndexOf(status.toLowerCase());
    if (statusOffset < 0) {
      continue;
    }
    const candidateStart = (match.index ?? 0) + statusOffset;
    const candidateEnd = candidateStart + status.length;
    const gap = prefix.slice(candidateEnd);
    if (stripHtmlPreservingLines(gap).trim()) {
      continue;
    }
    statusStart = candidateStart;
  }

  return statusStart;
}

function sliceRenderedCardBlock(
  content: string,
  anchorStart: number,
  libraryId: string,
  cardBlockStarts: RenderedCardBlockStart[],
) {
  const current = cardBlockStarts.find((entry) => entry.libraryId === libraryId);
  const blockStart = current?.start ?? anchorStart;
  const next = cardBlockStarts.find((entry) => entry.start > blockStart);
  const blockEnd = next?.start ?? content.length;
  return content.slice(blockStart, Math.max(blockStart, blockEnd));
}

type RenderedCardBoundary = { start: number; end: number; libraryIds: Set<string> };
type RenderedCardStackEntry = {
  name: string;
  start: number;
  boundary: boolean;
  libraryIds: Set<string>;
};

/** Scan semantic card boundaries once; selection for each ad is then local. */
function buildRenderedCardBoundaries(content: string): RenderedCardBoundary[] {
  const tagRegex = /<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)(?:\s[^>]*?)?>/gi;
  const stack: RenderedCardStackEntry[] = [];
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  let match: RegExpExecArray | null;
  const boundaries: RenderedCardBoundary[] = [];

  while ((match = tagRegex.exec(content))) {
    const rawTag = match[0];
    const name = match[1]?.toLowerCase();
    if (!name || rawTag.startsWith("<!--")) {
      continue;
    }
    if (rawTag.startsWith("</")) {
      const popped = popRenderedTag(stack, name);
      if (popped?.boundary) {
        boundaries.push({
          start: popped.start,
          end: (match.index ?? 0) + rawTag.length,
          libraryIds: popped.libraryIds,
        });
      }
      continue;
    }
    if (voidTags.has(name) || /\/\s*>$/.test(rawTag)) {
      continue;
    }
    const entry: RenderedCardStackEntry = {
      name,
      start: match.index ?? 0,
      boundary: isRenderedCardBoundary(rawTag, name),
      libraryIds: new Set<string>(),
    };
    const libraryId = name === "a" ? extractLibraryIdFromAnchorTag(rawTag) : null;
    if (libraryId) {
      for (const ancestor of stack) {
        if (ancestor.boundary) {
          ancestor.libraryIds.add(libraryId);
        }
      }
    }
    stack.push(entry);
  }

  return boundaries;
}

function extractLibraryIdFromAnchorTag(rawTag: string) {
  const href = rawTag.match(/\bhref=(['"])(.*?)\1/i)?.[2];
  return decodeHtmlEntity(href ?? "").match(/[?&](?:amp;)?id=(\d+)/)?.[1] ?? null;
}

/** Prefer the smallest real card boundary with exactly one Library ID. */
function findRenderedCardBoundary(boundaries: RenderedCardBoundary[], anchorStart: number) {
  return (
    boundaries
      .filter(
        (candidate) =>
          candidate.start <= anchorStart &&
          anchorStart < candidate.end &&
          candidate.libraryIds.size === 1,
      )
      .sort((left, right) => left.end - left.start - (right.end - right.start))[0] ?? null
  );
}

function popRenderedTag(stack: RenderedCardStackEntry[], name: string) {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].name !== name) {
      continue;
    }
    const [popped] = stack.splice(index, 1);
    return popped;
  }
  return null;
}

function isRenderedCardBoundary(rawTag: string, name: string) {
  return (
    name === "article" ||
    /\brole\s*=\s*["']article["']/i.test(rawTag) ||
    /\bdata-ad-preview(?:\s*=|\s|>)/i.test(rawTag)
  );
}

export function extractTextCardsFromVisibleText(value: string): ExtractedAdCard[] {
  const lines = value
    .replace(/\u200b/g, "\n")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const idIndexes = lines
    .map((line, index) => ({
      index,
      match: line.match(/^Library ID:\s*(\d+)/i),
    }))
    .filter((entry): entry is { index: number; match: RegExpMatchArray } => Boolean(entry.match));
  const cards: ExtractedAdCard[] = [];
  const seen = new Set<string>();

  for (let entryIndex = 0; entryIndex < idIndexes.length; entryIndex += 1) {
    const entry = idIndexes[entryIndex];
    const libraryId = entry.match[1];
    if (!libraryId || seen.has(libraryId)) {
      continue;
    }

    const previousLine = lines[entry.index - 1]?.toLowerCase();
    const blockStart =
      previousLine === "active" || previousLine === "inactive" ? entry.index - 1 : entry.index;
    const blockEnd = idIndexes[entryIndex + 1]?.index ?? lines.length;
    const block = lines.slice(blockStart, blockEnd);
    if (!block.some((line) => /^Sponsored$/i.test(line))) {
      continue;
    }

    const advertiser = inferAdvertiserFromTextBlock(block);
    const bodyLines = extractAdBodyLines(block);
    const body = bodyLines.join("\n").trim();
    const blockText = block.join("\n");
    seen.add(libraryId);

    cards.push({
      libraryId,
      advertiser,
      body: body || advertiser || blockText,
      previewHeadline: bodyLines[0] ?? advertiser,
      previewSubhead: bodyLines.slice(1, 3).join(" ") || null,
      cta: inferCta(blockText),
      adSnapshotUrl: `https://www.facebook.com/ads/library/?id=${libraryId}`,
      landingPageUrl: inferLandingPageFromTextBlock(block),
      platforms: inferPlatforms(blockText),
      active: !block.some((line) => /^Inactive$/i.test(line)),
      // isTextCardUiLine keeps this line out of the ad body; the block still
      // carries it, so capture Meta's published start date before it drops.
      startedRunning: findStartedRunningLine(blockText),
    });
  }

  return cards;
}

export function hasNoResultsSignal(value: string) {
  const normalized = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return (
    normalized.includes("no ads found") ||
    normalized.includes("no ads match") ||
    normalized.includes("no results") ||
    /\b0\s+results?\b/.test(normalized) ||
    /\bno\s+(ads?|results?)\s+(match|matched|found|available)\b/.test(normalized) ||
    /\bcouldn.?t find any ads\b/.test(normalized) ||
    /\bcould not find any ads\b/.test(normalized) ||
    /\bwe (didn't|did not) find any results\b/.test(normalized) ||
    /\bthere are no ads\b/.test(normalized)
  );
}

function inferAdvertiserFromTextBlock(block: string[]) {
  const detailIndex = block.findIndex((line) => /^See (ad|summary) details$/i.test(line));
  if (detailIndex >= 0) {
    const advertiser = block
      .slice(detailIndex + 1)
      .find((line) => !isTextCardUiLine(line) && !/^Sponsored$/i.test(line));
    if (advertiser) {
      return advertiser;
    }
  }

  const sponsoredIndex = block.findIndex((line) => /^Sponsored$/i.test(line));
  for (let index = sponsoredIndex - 1; index >= 0; index -= 1) {
    const line = block[index];
    if (line && !isTextCardUiLine(line)) {
      return line;
    }
  }

  return null;
}

function extractAdBodyLines(block: string[]) {
  const sponsoredIndex = block.findIndex((line) => /^Sponsored$/i.test(line));
  const afterSponsored = sponsoredIndex >= 0 ? block.slice(sponsoredIndex + 1) : block;
  const bodyLines: string[] = [];
  const seen = new Set<string>();

  for (const line of afterSponsored) {
    if (isTextCardUiLine(line) || /^Sponsored$/i.test(line)) {
      continue;
    }
    const normalized = normalizeExtractedBodyLine(line);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    bodyLines.push(line);
  }

  return bodyLines;
}

function normalizeExtractedBodyLine(line: string) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isTextCardUiLine(line: string) {
  return (
    /^Active$/i.test(line) ||
    /^Inactive$/i.test(line) ||
    /^Library ID:\s*\d+/i.test(line) ||
    /^Started running on\b/i.test(line) ||
    /^Platforms$/i.test(line) ||
    /^This ad has multiple versions$/i.test(line) ||
    /^\d+\s+ads?\s+use this creative and text$/i.test(line) ||
    /^Menu$/i.test(line) ||
    /^See (ad|summary) details$/i.test(line) ||
    /^\d+:\d+\s*\/\s*\d+:\d+/.test(line)
  );
}

function inferLandingPageFromTextBlock(block: string[]) {
  const domainLine = block.find((line) => /^[A-Z0-9.-]+\.[A-Z]{2,}(?:\/\S*)?$/i.test(line));
  if (!domainLine) {
    return null;
  }

  try {
    return new URL(`https://${domainLine.toLowerCase()}`).toString();
  } catch {
    return null;
  }
}

export function stripHtml(value: string) {
  return decodeHtmlEntity(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

// Only a standalone status line counts; matching the word inside ad copy is not enough.
export function hasStandaloneInactiveLine(text: string) {
  return text.split("\n").some((line) => /^inactive$/i.test(line.trim()));
}

export function stripHtmlPreservingLines(value: string) {
  return decodeHtmlEntity(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(/<\/?(?:article|aside|button|div|h[1-6]|li|main|p|section|strong)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n"),
  );
}

export function decodeHtmlEntity(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, " ")
    .trim();
}

export function extractExternalLink(html: string) {
  const hrefRegex = /\bhref=(['"])(.*?)\1/gi;
  for (const match of html.matchAll(hrefRegex)) {
    const href = decodeHtmlEntity(match[2] ?? "");
    if (
      /^https?:/i.test(href) &&
      !/facebook\.com/i.test(href) &&
      !/l\.facebook\.com/i.test(href)
    ) {
      return href;
    }
  }

  return null;
}

/**
 * Pull a creative thumbnail URL from card HTML (Browserless / Quick Action scrape).
 * Prefers video posters, then the largest measurable fbcdn/scontent image, skipping
 * tiny square profile-like assets when width/height attributes are present.
 */
export function extractCreativeMediaFromHtml(html: string): {
  imageUrl: string | null;
  hasVideo: boolean;
} {
  const hasVideo = /<video\b/i.test(html);
  const posterMatch = html.match(/<video\b[^>]*\bposter=(['"])(.*?)\1/i);
  const posterUrl = posterMatch?.[2] ? normalizeCreativeCdnUrl(decodeHtmlEntity(posterMatch[2])) : null;
  if (posterUrl) {
    return { imageUrl: posterUrl, hasVideo: true };
  }

  const imgRegex = /<img\b([^>]*)>/gi;
  let bestUrl: string | null = null;
  let bestArea = -1;
  let firstCdnUrl: string | null = null;

  for (const match of html.matchAll(imgRegex)) {
    const attrs = match[1] ?? "";
    const src = readHtmlAttribute(attrs, "src");
    if (!src) {
      continue;
    }
    const normalized = normalizeCreativeCdnUrl(decodeHtmlEntity(src));
    if (!normalized) {
      continue;
    }
    if (!firstCdnUrl) {
      firstCdnUrl = normalized;
    }

    const width = readPositiveDimension(attrs, "width");
    const height = readPositiveDimension(attrs, "height");
    if (width !== null && height !== null && width <= 64 && height <= 64) {
      continue;
    }
    const area = (width ?? 1) * (height ?? 1);
    if (area > bestArea) {
      bestArea = area;
      bestUrl = normalized;
    }
  }

  return {
    imageUrl: bestUrl ?? firstCdnUrl,
    hasVideo,
  };
}

function readHtmlAttribute(attrs: string, name: string) {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, "i"));
  return match?.[2]?.trim() || null;
}

function readPositiveDimension(attrs: string, name: string) {
  const raw = readHtmlAttribute(attrs, name);
  if (!raw) {
    return null;
  }
  const parsed = Number.parseInt(raw.replace(/px$/i, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeCreativeCdnUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("data:")) {
    return null;
  }

  try {
    const url = new URL(trimmed, "https://www.facebook.com");
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    const host = url.hostname.toLowerCase();
    if (!host.includes("fbcdn") && !host.includes("scontent")) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function absolutizeMetaAdUrl(href: string) {
  try {
    return new URL(href, "https://www.facebook.com").toString();
  } catch {
    return `https://www.facebook.com/ads/library/?id=${href}`;
  }
}

export function inferCta(text: string | null) {
  if (!text) {
    return null;
  }

  const match = text.match(/\b(Shop now|Learn more|Sign up|Apply now|Book now|Contact us)\b/i);
  return match?.[1] ?? null;
}

export function inferPlatforms(text: string | null) {
  const value = text ?? "";
  return ["Instagram", "Facebook", "Messenger", "WhatsApp", "Audience Network", "Threads"].filter(
    (token) => value.includes(token),
  );
}
