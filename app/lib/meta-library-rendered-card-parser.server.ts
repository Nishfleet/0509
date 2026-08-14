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
  active: boolean | null;
  /** Raw "Started running on <date>" card line; parsed server-side into firstSeenAt. */
  startedRunning?: string | null;
  /** First creative CDN image (fbcdn/scontent) found on the card, if any. */
  imageUrl?: string | null;
  /** True when a <video> element (or poster) was present on the card. */
  hasVideo?: boolean;
  /** Parsed from "N ads use this creative and text" when present. */
  variantCount?: number | null;
  /**
   * Numeric Meta Page id of the advertiser for this card, resolved from the Ad
   * Library relay payload (ad_archive_id → page_id) or a numeric advertiser-page
   * link. Enables verified page-scoped re-scans. Null when unresolved.
   */
  pageId?: string | null;
}

export interface AdArchivePageIdentity {
  pageId: string;
  pageName: string | null;
}

export interface RenderedHtmlPayload {
  cards: ExtractedAdCard[];
  loginWall: boolean;
  noResults: boolean;
  rateLimited: boolean;
}

/** Parse Browserless/Quick Actions rendered HTML without depending on a DOM runtime. */
export function parseRenderedMetaLibraryHtml(
  content: string,
): RenderedHtmlPayload {
  const visibleText = stripHtmlPreservingLines(content);
  const text = visibleText.toLowerCase();
  const pageIdentities = extractAdArchivePageIdentities(content);
  const cards: ExtractedAdCard[] = [];
  const seen = new Set<string>();
  const anchorRegex = /<a\b[^>]*href=(['"])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;

  const adAnchorMatches = Array.from(content.matchAll(anchorRegex)).filter(
    (match) => {
      const href = decodeHtmlEntity(match[2] ?? "");
      return (
        /\/ads\/library\/\?/.test(href) ||
        /facebook\.com\/ads\/library\/\?/.test(href)
      );
    },
  );
  const cardBlockStarts = buildRenderedCardBlockStarts(
    content,
    adAnchorMatches,
  );
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
    const renderedCardBoundary = findRenderedCardBoundary(
      renderedCardBoundaries,
      anchorStart,
    );
    const contextHtml = renderedCardBoundary
      ? content.slice(renderedCardBoundary.start, renderedCardBoundary.end)
      : sliceRenderedCardBlock(
          content,
          anchorStart,
          libraryId,
          cardBlockStarts,
        );
    const contextLineText = stripHtmlPreservingLines(contextHtml);
    const localAnchorIndex = contextHtml.indexOf(match[0]);
    const relayIdentity = pageIdentities.get(libraryId);
    // Prefer a DOM-scraped name when present; fall back to the Relay
    // page_name (authoritative advertiser identity Meta ships with each
    // ad_archive_id). Never invent a name from the search query.
    const advertiser =
      extractRenderedAdvertiser(contextHtml, localAnchorIndex) ||
      relayIdentity?.pageName ||
      null;
    const body = /(^|\n)Sponsored($|\n)/i.test(contextLineText)
      ? extractAdCopyFromCardText(contextLineText)
      : extractRenderedParagraphCopy(contextHtml) ||
        extractRenderedTrailingEmphasisCopy(contextHtml, localAnchorIndex);
    const cta = inferCta(contextLineText);
    const landingPageUrl =
      extractExternalLink(contextHtml) ??
      inferLandingPageFromTextBlock(
        contextLineText
          .split(/\n+/)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    const media = extractCreativeMediaFromHtml(contextHtml);
    const variantCount = extractVariantCountFromText(contextLineText);

    cards.push({
      libraryId,
      advertiser,
      body: body || null,
      previewHeadline: stripHtml(match[3] ?? "") || null,
      previewSubhead: null,
      cta,
      adSnapshotUrl: absolutizeMetaAdUrl(href),
      landingPageUrl,
      platforms: inferPlatforms(contextLineText),
      active: readStandaloneActiveStatus(contextLineText),
      startedRunning: findStartedRunningLine(contextLineText),
      imageUrl: media.imageUrl,
      hasVideo: media.hasVideo,
      variantCount,
      pageId:
        relayIdentity?.pageId ??
        extractNumericPageIdFromAdvertiserHtml(contextHtml),
    });
  }

  const resolvedCards =
    cards.length > 0 ? cards : extractTextCardsFromVisibleText(visibleText);

  return {
    cards: applyRelayPageIdentitiesToCards(resolvedCards, pageIdentities),
    loginWall:
      /log in|login|sign in|sign into/.test(text) && text.includes("facebook"),
    noResults: hasNoResultsSignal(visibleText),
    rateLimited:
      text.includes("rate limit") ||
      text.includes("too many requests") ||
      text.includes("try again later"),
  };
}

function isPlausibleAdvertiserName(value: string) {
  // Reject HTML fragments (e.g. a dangling "<div" left when the Sponsored
  // match starts at the closing ">" of an open tag) and other non-names.
  if (!value || /[<>{}]/.test(value)) {
    return false;
  }
  if (isTextCardUiLine(value)) {
    return false;
  }
  return value.length > 1 && value.length <= 60 && value.split(/\s+/).length <= 6;
}

function extractRenderedAdvertiser(contextHtml: string, anchorIndex: number) {
  const prefix = anchorIndex >= 0 ? contextHtml.slice(0, anchorIndex) : "";
  const sponsoredMatch = prefix.match(/(?:^|>)\s*Sponsored\s*(?:<|$)/i);
  if (!sponsoredMatch || sponsoredMatch.index === undefined) {
    return null;
  }
  // When the match begins on the ">" of an open tag (`<div>Sponsored`), slice
  // after that ">" so the dangling open tag is not treated as a name.
  const matchStartsOnTagClose = prefix[sponsoredMatch.index] === ">";
  const regionEnd = matchStartsOnTagClose
    ? sponsoredMatch.index + 1
    : sponsoredMatch.index;
  const advertiserRegion = prefix.slice(0, regionEnd);
  const matches = Array.from(
    advertiserRegion.matchAll(
      /<(?:strong|h3|h4)\b[^>]*>([\s\S]*?)<\/(?:strong|h3|h4)>/gi,
    ),
  );
  const candidates = [
    ...new Set(
      matches
        .map((match) => stripHtml(match[1] ?? ""))
        .filter((value) => isPlausibleAdvertiserName(value)),
    ),
  ];
  if (candidates.length === 1) {
    return candidates[0];
  }
  // Logged-out grid cards frequently render the advertiser as a plain text
  // line (or unstyled span/link) above "Sponsored" with no strong/h3 wrapper.
  // Recover the nearest short, non-UI line so we do not invent an identity.
  if (candidates.length === 0) {
    const lines = stripHtmlPreservingLines(advertiserRegion)
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((value) => isPlausibleAdvertiserName(value));
    const nearest = lines[lines.length - 1];
    if (nearest) {
      return nearest;
    }
  }
  return null;
}

function extractRenderedParagraphCopy(contextHtml: string) {
  return Array.from(contextHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => stripHtml(match[1] ?? ""))
    .map(stripTrailingRenderedUi)
    .filter((value) => value && !isTextCardUiLine(value))
    .join("\n")
    .trim();
}

function stripTrailingRenderedUi(value: string) {
  return value
    .replace(
      /\s+(?:(?:Instagram|Facebook|Messenger|WhatsApp|Audience Network|Threads)\s*)+(?:(?:Shop now|Learn more|Sign up|Apply now|Book now|Contact us))?\s*$/i,
      "",
    )
    .replace(
      /([.!?])\s+(?:Shop now|Learn more|Sign up|Apply now|Book now|Contact us)\s*$/i,
      "$1",
    )
    .trim();
}

function extractRenderedTrailingEmphasisCopy(
  contextHtml: string,
  anchorIndex: number,
) {
  const suffix = anchorIndex >= 0 ? contextHtml.slice(anchorIndex) : "";
  return Array.from(
    suffix.matchAll(
      /<(?:strong|h3|h4)\b[^>]*>([\s\S]*?)<\/(?:strong|h3|h4)>/gi,
    ),
  )
    .map((match) => stripHtml(match[1] ?? ""))
    .filter((value) => value && !isTextCardUiLine(value))
    .join("\n")
    .trim();
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
    const start =
      findStandaloneStatusImmediatelyBefore(content, libraryIdStart) ??
      libraryIdStart;
    const current = starts.get(libraryId);
    starts.set(
      libraryId,
      current === undefined ? start : Math.min(current, start),
    );
  }

  return [...starts]
    .map(([libraryId, start]) => ({ libraryId, start }))
    .sort((a, b) => a.start - b.start);
}

function findStandaloneStatusImmediatelyBefore(
  content: string,
  beforeIndex: number,
) {
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

    const statusOffset = matched
      .toLowerCase()
      .lastIndexOf(status.toLowerCase());
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
  const current = cardBlockStarts.find(
    (entry) => entry.libraryId === libraryId,
  );
  const blockStart = current?.start ?? anchorStart;
  const next = cardBlockStarts.find((entry) => entry.start > blockStart);
  const blockEnd = next?.start ?? content.length;
  return content.slice(blockStart, Math.max(blockStart, blockEnd));
}

type RenderedCardBoundary = {
  start: number;
  end: number;
  libraryIds: Set<string>;
};
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
    const libraryId =
      name === "a" ? extractLibraryIdFromAnchorTag(rawTag) : null;
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
  return (
    decodeHtmlEntity(href ?? "").match(/[?&](?:amp;)?id=(\d+)/)?.[1] ?? null
  );
}

/** Prefer the smallest real card boundary with exactly one Library ID. */
function findRenderedCardBoundary(
  boundaries: RenderedCardBoundary[],
  anchorStart: number,
) {
  return (
    boundaries
      .filter(
        (candidate) =>
          candidate.start <= anchorStart &&
          anchorStart < candidate.end &&
          candidate.libraryIds.size === 1,
      )
      .sort(
        (left, right) => left.end - left.start - (right.end - right.start),
      )[0] ?? null
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

export function extractTextCardsFromVisibleText(
  value: string,
): ExtractedAdCard[] {
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
    .filter((entry): entry is { index: number; match: RegExpMatchArray } =>
      Boolean(entry.match),
    );
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
      previousLine === "active" || previousLine === "inactive"
        ? entry.index - 1
        : entry.index;
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
      active: readStandaloneActiveStatus(blockText),
      // isTextCardUiLine keeps this line out of the ad body; the block still
      // carries it, so capture Meta's published start date before it drops.
      startedRunning: findStartedRunningLine(blockText),
      variantCount: extractVariantCountFromText(blockText),
    });
  }

  return cards;
}

/** Parse "N ads use this creative and text" into a variant count. */
export function extractVariantCountFromText(
  value: string | null | undefined,
): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/(\d+)\s+ads?\s+use this creative and text/i);
  if (!match?.[1]) {
    return null;
  }
  const count = Number.parseInt(match[1], 10);
  return Number.isFinite(count) && count > 0 ? count : null;
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
    /\bno\s+(ads?|results?)\s+(match|matched|found|available)\b/.test(
      normalized,
    ) ||
    /\bcouldn.?t find any ads\b/.test(normalized) ||
    /\bcould not find any ads\b/.test(normalized) ||
    /\bwe (didn't|did not) find any results\b/.test(normalized) ||
    /\bthere are no ads\b/.test(normalized)
  );
}

function inferAdvertiserFromTextBlock(block: string[]) {
  const detailIndex = block.findIndex((line) =>
    /^See (ad|summary) details$/i.test(line),
  );
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

export function extractAdBodyLines(block: string[]) {
  const sponsoredIndex = block.findIndex((line) => /^Sponsored$/i.test(line));
  const afterSponsored =
    sponsoredIndex >= 0 ? block.slice(sponsoredIndex + 1) : block;
  const bodyLines: string[] = [];
  const seen = new Set<string>();

  for (const line of afterSponsored) {
    if (
      isTextCardUiLine(line) ||
      isLandingPageEvidenceLine(line) ||
      /^Sponsored$/i.test(line)
    ) {
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

/**
 * FIX-13: strip Ad Library chrome lines from a free-form body string before
 * hook/offer derivation (DOM/session paths that skip extractAdBodyLines).
 */
export function stripAdLibraryUiChromeFromBody(body: string): string {
  const lines = truncateAtAdLibraryPageChrome(body)
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);
  const cleaned = extractAdBodyLines(lines);
  return cleaned.join("\n").trim();
}

/**
 * The last card on an Ad Library page can absorb the page footer into its
 * innerText as one run-on line ("\u2026Shop Now See more System status Ad Library
 * API About ads and data use \u2026 Meta \u00a9 2026"), which line-based filtering cannot
 * catch. Truncate at the first footer marker instead.
 */
const AD_LIBRARY_PAGE_CHROME_MARKERS = [
  "See more System status",
  "System status Ad Library",
  "Ad Library API",
  "About ads and data use",
  "Meta \u00a9 20",
];

export function truncateAtAdLibraryPageChrome(text: string): string {
  let cutAt = -1;
  for (const marker of AD_LIBRARY_PAGE_CHROME_MARKERS) {
    const index = text.indexOf(marker);
    if (index >= 0 && (cutAt === -1 || index < cutAt)) {
      cutAt = index;
    }
  }
  return cutAt >= 0 ? text.slice(0, cutAt).trimEnd() : text;
}

/** Remove Meta Ad Library controls and metadata before analyzing ad copy. */
export function extractAdCopyFromCardText(value: string) {
  const lines = value
    .replace(/\u200b/g, "\n")
    .replace(/\u00a0/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .map(stripTrailingRenderedUi)
    .filter(Boolean);

  return extractAdBodyLines(lines).join("\n").trim();
}

export function readStandaloneActiveStatus(value: string) {
  const status = value
    .split(/\n+/)
    .map((line) => line.trim().toLowerCase())
    .find((line) => line === "active" || line === "inactive");
  return status === "active" ? true : status === "inactive" ? false : null;
}

function normalizeExtractedBodyLine(line: string) {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Meta Ad Library card controls that are sometimes captured as the ad's CTA
 * (the card overflow "Menu"/"Open Drop-down" button, "See ad details" links,
 * the "More" expand control, "Report ad", or the "Meta Ad Library result"
 * label). Exact-match only: real advertiser CTAs ("Shop now", "Get offer",
 * …) never collide with these tokens.
 */
const AD_LIBRARY_CHROME_CTA_TOKENS = [
  "menu",
  "open drop-down",
  "see ad details",
  "see summary details",
  "view ad details",
  "meta ad library result",
  "more",
  "report ad",
];

/**
 * True when a captured CTA value is pure Meta Ad Library chrome that must
 * never render as the advertiser's call to action. Applied at the
 * normalization choke point so no extraction path (session DOM, Quick
 * Actions, Browserless, rendered-text) can surface it on public search.
 */
export function isAdLibraryChromeCta(
  value: string | null | undefined,
): boolean {
  if (!value) {
    return false;
  }
  const normalized = value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return AD_LIBRARY_CHROME_CTA_TOKENS.includes(normalized);
}

export function isTextCardUiLine(line: string) {
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
    /^View ad details$/i.test(line) ||
    /^Meta Ad Library result$/i.test(line) ||
    /^(?:Instagram|Facebook|Messenger|WhatsApp|Audience Network|Threads)$/i.test(
      line,
    ) ||
    /^(?:Shop now|Learn more|Sign up|Apply now|Book now|Contact us)$/i.test(
      line,
    ) ||
    /^\d+:\d+\s*\/\s*\d+:\d+/.test(line)
  );
}

function isLandingPageEvidenceLine(line: string) {
  const value = line.trim();
  return (
    /^[A-Z0-9.-]+\.[A-Z]{2,}(?:\/\S*)?$/i.test(value) ||
    /^https?:\/\/[^\s]+$/i.test(value)
  );
}

function inferLandingPageFromTextBlock(block: string[]) {
  const domainLine = block.find(isLandingPageEvidenceLine);
  if (!domainLine) {
    return null;
  }

  try {
    const normalized = /^https?:\/\//i.test(domainLine)
      ? domainLine
      : `https://${domainLine.toLowerCase()}`;
    return new URL(normalized).toString();
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
      .replace(
        /<\/?(?:article|aside|button|div|h[1-6]|li|main|p|section|strong)\b[^>]*>/gi,
        "\n",
      )
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
 * Hard upper bound on how far past each ad_archive_id we scan for page_id /
 * page_name when the next ad_archive_id is missing or extremely far. Real
 * collated_results nodes are ~12k chars; page_name often sits inside
 * `snapshot` after several other fields, so the old 800-char cap captured
 * page_id but dropped page_name on live payloads.
 */
const RELAY_IDENTITY_WINDOW_MAX = 50_000;

/**
 * The rendered Ad Library ships a Relay payload where each result node carries
 * `ad_archive_id` alongside the advertiser's numeric `page_id` and `page_name`
 * (e.g. `"ad_archive_id":"186…","…","page_id":"15087023444","…"`). That map is
 * the authoritative, per-ad advertiser identity — far more reliable than DOM
 * scraping — so we key it by library id (= ad_archive_id) for page-scoped
 * re-scans and for filling the advertiser name when the card DOM has no
 * strong/h3 name. Bounded to the first identity seen per id (Relay repeats it).
 */
export function extractAdArchivePageIdentities(
  content: string,
): Map<string, AdArchivePageIdentity> {
  const identities = new Map<string, AdArchivePageIdentity>();
  // Anchor on each ad_archive_id, then read the page_id/page_name from a forward
  // window bounded by the NEXT ad_archive_id (else +RELAY_IDENTITY_WINDOW_MAX).
  // Real Ad Library nodes sit ~12k chars apart; page_id is usually ~95 chars
  // past ad_archive_id, while page_name often lives deeper inside snapshot.
  // `[\\]?` tolerates the escaped quotes Meta uses when Relay JSON is embedded
  // as a string.
  const idRegex = /[\\]?"ad_archive_id[\\]?"\s*:\s*[\\]?"(\d+)[\\]?"/g;
  const matches = [...content.matchAll(idRegex)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const libraryId = match[1];
    if (!libraryId || identities.has(libraryId) || match.index === undefined) {
      continue;
    }
    const windowStart = match.index + match[0].length;
    const nextIndex = matches[index + 1]?.index ?? content.length;
    const windowEnd = Math.min(
      nextIndex,
      windowStart + RELAY_IDENTITY_WINDOW_MAX,
    );
    const window = content.slice(windowStart, windowEnd);
    const pageId =
      window.match(/[\\]?"page_id[\\]?"\s*:\s*[\\]?"(\d{5,})[\\]?"/)?.[1] ?? null;
    if (!pageId) {
      continue;
    }
    const rawName =
      window.match(
        /[\\]?"page_name[\\]?"\s*:\s*[\\]?"((?:[^"\\]|\\.){0,120}?)[\\]?"/,
      )?.[1] ?? null;
    identities.set(libraryId, {
      pageId,
      pageName: rawName ? decodeJsonStringFragment(rawName) : null,
    });
  }
  return identities;
}

/**
 * Fill missing advertiser / pageId on scraped cards from the Relay identity
 * map. DOM names win when present (they are what the customer saw on the
 * card); Relay page_name fills honest gaps only. Never invents a name from
 * the customer's search term.
 */
export function applyRelayPageIdentitiesToCards(
  cards: ExtractedAdCard[],
  identities: Map<string, AdArchivePageIdentity>,
): ExtractedAdCard[] {
  if (cards.length === 0 || identities.size === 0) {
    return cards;
  }

  return cards.map((card) => {
    const identity = identities.get(card.libraryId);
    if (!identity) {
      return card;
    }

    const scrapedAdvertiser = card.advertiser?.trim() || "";
    // Treat HTML fragments / non-names as missing so Relay page_name can fill
    // the honest gap instead of locking in garbage that became "confirmed".
    const usableScraped =
      scrapedAdvertiser && !/[<>{}]/.test(scrapedAdvertiser)
        ? scrapedAdvertiser
        : "";
    const relayAdvertiser = identity.pageName?.trim() || "";
    const advertiser = usableScraped || relayAdvertiser || null;
    const pageId = card.pageId || identity.pageId || null;

    if (advertiser === card.advertiser && pageId === card.pageId) {
      return card;
    }

    return {
      ...card,
      advertiser,
      pageId,
    };
  });
}

/**
 * The current Ad Library links each card's advertiser name to their Page. When
 * that link is numeric (`facebook.com/61578892468353/`) the digits ARE the
 * page id. Vanity links (`facebook.com/nike/`) carry no numeric id and return
 * null — those resolve via the Relay map instead.
 */
export function extractNumericPageIdFromAdvertiserHtml(html: string): string | null {
  const hrefRegex = /\bhref=(['"])(.*?)\1/gi;
  for (const match of html.matchAll(hrefRegex)) {
    const href = decodeHtmlEntity(match[2] ?? "");
    const pageId = numericPageIdFromFacebookProfileHref(href);
    if (pageId) {
      return pageId;
    }
  }
  return null;
}

/** `https://www.facebook.com/<digits>/` → `<digits>`; everything else → null. */
export function numericPageIdFromFacebookProfileHref(
  href: string | null | undefined,
): string | null {
  if (!href) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(href, "https://www.facebook.com");
  } catch {
    return null;
  }
  if (!/(^|\.)facebook\.com$/i.test(parsed.hostname)) {
    return null;
  }
  const match = parsed.pathname.match(/^\/(\d{5,})\/?$/);
  return match ? match[1] : null;
}

function decodeJsonStringFragment(value: string) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/\\"/g, '"')
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\")
    .trim();
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
  const posterUrl = posterMatch?.[2]
    ? normalizeCreativeCdnUrl(decodeHtmlEntity(posterMatch[2]))
    : null;
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
  const match = attrs.match(
    new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, "i"),
  );
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

  const match = text.match(
    /\b(Shop now|Learn more|Sign up|Apply now|Book now|Contact us)\b/i,
  );
  return match?.[1] ?? null;
}

export function inferPlatforms(text: string | null) {
  const value = text ?? "";
  return [
    "Instagram",
    "Facebook",
    "Messenger",
    "WhatsApp",
    "Audience Network",
    "Threads",
  ].filter((token) => value.includes(token));
}
