export const LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION = "lp-signals-v4";

const CTA_PRIORITY_PATTERNS = [
  /\b(buy now|shop now|add to cart|get offer|claim deal|book demo|whatsapp us|get started)\b/i,
  /\b(order now|start now|apply now|join now|download app|talk to us)\b/i,
  /\bsubmit\b/i,
] as const;

const PRICE_PATTERNS = [
  /\b(starting at\s+(?:₹|rs\.?\s*)\s*\d[\d,]*)\b/i,
  /\b((?:₹|rs\.?\s*)\s*\d[\d,]*)\b/i,
  /((?:[$€£]\s*)\d[\d,]*(?:\.\d{1,2})?)/i,
  /\b((?:usd|eur|gbp)\s+\d[\d,]*(?:\.\d{1,2})?)\b/i,
  /\b((?:up to\s+)?\d+%\s*off)\b/i,
  /\b(buy\s*\d+\s*get\s*\d+)\b/i,
] as const;
const LEAD_FIELD_PATTERN = /\b(name|email|phone|mobile|tel|whatsapp)\b/i;
const MAX_HTML_TAG_SCAN_LENGTH = 4_096;
const HIDDEN_RECOVERY_TAG_NAMES = new Set(["script", "style", "template"]);
const HEAD_ELEMENT_NAMES = new Set([
  "base",
  "basefont",
  "bgsound",
  "head",
  "link",
  "meta",
  "noframes",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);
const HEAD_CONTENT_CONTAINER_NAMES = new Set([
  "noframes",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);
const SHELL_PLACEHOLDER_PATTERN =
  /^(?:loading(?:\s+(?:app|application))?(?:,\s*please wait)?|please wait|initializing)(?:[.!…]+)?$/i;

// Ad-slot suppression (lp-signals-v4): rotating third-party ad creatives are
// the loudest remaining landing-page noise source. A banner that swaps
// between "Buy now · $19.99" and "Claim deal · $9.99" must never become
// customer-visible offer/CTA/form events, so ad containers are stripped from
// signal extraction the same way script/style content already is.
//
// Two recognition paths run together:
//   1. id/class token match against AD_SLOT_MARKER_TOKENS — covers the common
//      "ad", "adsbygoogle", "taboola", "dfp" ids and the vendor class names
//   2. AD_SLOT_DATA_ATTRIBUTE_NAMES — Google Ad Manager signatures that
//      appear with no id/class at all (a `<div data-ad-slot="1234567">`
//      houses exactly the same rotating creatives as a labelled banner)
//
// Both paths are deliberately tolerant: a false negative leaks ad copy into
// the diff (a churn event), a false positive strips real product copy (a
// missed event). The cost balance favours noise suppression — the existing
// fail-safe bound keeps anything we cannot confidently close intact.
const AD_SLOT_MARKER_TOKENS = new Set([
  "ad",
  "ads",
  "adslot",
  "adunit",
  "adbox",
  "advert",
  "adverts",
  "advertisement",
  "advertising",
  "advertisment",
  "adcontainer",
  "adwrapper",
  "adsbygoogle",
  "adsense",
  "googleads",
  "googletag",
  "doubleclick",
  "dfp",
  "sponsored",
  "sponsor",
  "sponsors",
  "sponsorship",
  "taboola",
  "outbrain",
  "criteo",
  "prebid",
  "amazonads",
  "adchoices",
  "promoads",
  "nativeads",
  "leaderboard",
  "skyscraper",
  "inread",
  "infeed",
  "popunder",
  "interstitial",
  "affiliate",
]);
// Google Ad Manager attributes: every one of these is the GAM signature on a
// rotating ad slot. The values are slot IDs / client codes / format hints, not
// human copy — we never read them, only check for the attribute name.
const AD_SLOT_DATA_ATTRIBUTE_NAMES = new Set([
  "data-ad-slot",
  "data-ad-unit",
  "data-ad-client",
  "data-ad-format",
  "data-ad-layout",
  "data-ad-layout-key",
  "data-ad-test",
]);
// Elements that are structurally ad frames: no page-owned copy lives inside
// them, and cross-origin ad iframes rotate content beyond our visibility.
const AD_SLOT_BARE_TAG_NAMES = new Set(["iframe", "fencedframe", "amp-ad"]);
// Containers whose text can look like markup. Treated as opaque by the ad
// pre-pass so JS strings like "<div class=ad>" can never mask real content.
const AD_SLOT_OPAQUE_TAG_NAMES = new Set(["script", "style", "template"]);
// A bounded ad region that never closes is treated as NOT an ad region:
// stripping to a malformed end could eat real offer/copy content after it.
const AD_SLOT_REGION_SCAN_LIMIT = 24 * 1024;

export function extractLandingPageSignals(
  html: string,
  options: { documentMode?: "raw" | "rendered" } = {},
) {
  const normalizedHtml = removeNonVisibleElements(
    html ?? "",
    options.documentMode ?? "raw",
  );
  const ctaCandidates = [
    ...extractButtonText(normalizedHtml),
    ...extractSubmitValues(normalizedHtml),
    ...extractActionLinks(normalizedHtml),
  ].map(cleanText);

  const ctaText = pickBestCta(ctaCandidates);
  const priceText = pickPrice(normalizedHtml);
  const formPresent = detectFormPresence(normalizedHtml);

  return {
    ctaText,
    priceText,
    formPresent,
    extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
  };
}

export function hasMeaningfulLandingPageBodyText(
  html: string,
  options: { documentMode?: "raw" | "rendered" } = {},
) {
  const bodyHtml = removeNonVisibleElements(
    html ?? "",
    options.documentMode ?? "raw",
    true,
    true,
  );
  const bodyText = cleanText(stripTags(bodyHtml));
  return bodyText.length > 0 && !SHELL_PLACEHOLDER_PATTERN.test(bodyText);
}

function removeNonVisibleElements(
  html: string,
  documentMode: "raw" | "rendered",
  removeDocumentMetadata = false,
  ignoreNoscript = false,
) {
  const adSlotStripped = stripAdSlotRegions(html ?? "");
  const elementNames = new Set(
    documentMode === "rendered"
      ? ["script", "style", "noscript", "template"]
      : ["script", "style", "template"],
  );
  if (removeDocumentMetadata) {
    elementNames.add("head");
    elementNames.add("title");
  }
  if (ignoreNoscript) {
    elementNames.add("noscript");
  }
  const output: string[] = [];
  let copyFrom = 0;
  let cursor = 0;
  let hiddenElement: string | null = null;
  let hiddenDepth = 0;
  const headContentElements: string[] = [];

  while (cursor < adSlotStripped.length) {
    const tagStart = adSlotStripped.indexOf("<", cursor);
    if (tagStart < 0) break;
    if (
      (!hiddenElement ||
        (hiddenElement === "head" && headContentElements.length === 0)) &&
      adSlotStripped.startsWith("<!--", tagStart)
    ) {
      const commentEnd = adSlotStripped.indexOf("-->", tagStart + 4);
      if (!hiddenElement) {
        output.push(adSlotStripped.slice(copyFrom, tagStart), " ");
        copyFrom = commentEnd < 0 ? adSlotStripped.length : commentEnd + 3;
      }
      cursor = commentEnd < 0 ? adSlotStripped.length : commentEnd + 3;
      if (commentEnd < 0) break;
      continue;
    }
    const prefix = readHtmlTagPrefix(adSlotStripped, tagStart);
    const hiddenOpeningTag = Boolean(
      prefix &&
      !prefix.closing &&
      elementNames.has(prefix.name),
    );
    const parsedTag = readHtmlTag(
      adSlotStripped,
      tagStart,
      hiddenOpeningTag ? adSlotStripped.length - tagStart : undefined,
      !hiddenOpeningTag,
      hiddenElement,
    );
    const tag = parsedTag.tag;
    if (!tag) {
      if (hiddenOpeningTag) {
        if (!hiddenElement) {
          output.push(adSlotStripped.slice(copyFrom, tagStart), " ");
        }
        copyFrom = adSlotStripped.length;
        break;
      }
      cursor = parsedTag.nextCursor;
      continue;
    }

    if (!hiddenElement) {
      if (!tag.closing && elementNames.has(tag.name)) {
        output.push(adSlotStripped.slice(copyFrom, tagStart), " ");
        copyFrom = tag.end;
        // HTML ignores XHTML-style slashes on these non-void elements. An
        // empty <head/> is the exception here because browsers implicitly
        // close it at body flow even without a literal </head>.
        if (!tag.selfClosing || tag.name !== "head") {
          hiddenElement = tag.name;
          hiddenDepth = 1;
        }
      }
    } else if (hiddenElement === "head" && headContentElements.length > 0) {
      const currentHeadContent =
        headContentElements[headContentElements.length - 1];
      if (tag.closing && tag.name === currentHeadContent) {
        headContentElements.pop();
      } else if (
        currentHeadContent === "template" &&
        !tag.closing &&
        HEAD_CONTENT_CONTAINER_NAMES.has(tag.name)
      ) {
        headContentElements.push(tag.name);
      }
    } else if (
      hiddenElement === "head" &&
      !tag.closing &&
      HEAD_CONTENT_CONTAINER_NAMES.has(tag.name)
    ) {
      headContentElements.push(tag.name);
    } else if (
      hiddenElement === "head" &&
      !tag.closing &&
      !HEAD_ELEMENT_NAMES.has(tag.name)
    ) {
      hiddenElement = null;
      hiddenDepth = 0;
      copyFrom = tagStart;
    } else if (tag.name === hiddenElement) {
      if (
        hiddenElement === "template" &&
        !tag.closing
      ) {
        hiddenDepth += 1;
      } else if (tag.closing) {
        hiddenDepth -= 1;
        if (hiddenDepth === 0) {
          hiddenElement = null;
          copyFrom = tag.end;
        }
      }
    }

    cursor = parsedTag.nextCursor;
  }

  if (!hiddenElement) {
    output.push(adSlotStripped.slice(copyFrom));
  }
  return output.join("");
}

/**
 * Remove third-party ad containers before any signal extraction. Ad-slot
 * creatives rotate independently of the page's own offer, price, CTA, and
 * form structure, so their text must never feed the customer-facing change
 * diff. This is a tolerant pre-pass over the same hand-rolled scanner as the
 * main pass; unclosable regions fail safe (kept) rather than risk eating
 * real content that follows malformed ad markup.
 */
function stripAdSlotRegions(html: string) {
  const output: string[] = [];
  let copyFrom = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;
    const prefix = readHtmlTagPrefix(html, tagStart);
    if (!prefix) {
      cursor = tagStart + 1;
      continue;
    }
    if (prefix.closing) {
      cursor = tagStart + 1;
      continue;
    }
    if (AD_SLOT_OPAQUE_TAG_NAMES.has(prefix.name)) {
      // Script/style/template text can contain tag-looking markup (JS
      // strings, CSS content). Skip to the real closing tag so a fake
      // "<div class=ad>" inside a string can never trigger a strip.
      const opaqueEnd = findOpaqueContainerEnd(html, tagStart, prefix.name);
      cursor = opaqueEnd ?? html.length;
      continue;
    }
    const parsedTag = readHtmlTag(html, tagStart);
    if (!parsedTag.tag) {
      cursor = parsedTag.nextCursor;
      continue;
    }
    if (
      !isAdSlotContainerTag(
        prefix.name,
        html.slice(tagStart, parsedTag.tag.end),
      )
    ) {
      cursor = parsedTag.tag.end;
      continue;
    }
    const regionEnd = findAdSlotRegionEnd(
      html,
      tagStart,
      prefix.name,
      parsedTag.tag.end,
    );
    if (regionEnd === null) {
      // Unbounded ad region: keep it (current behavior) instead of
      // stripping the rest of the page.
      cursor = tagStart + 1;
      continue;
    }
    output.push(html.slice(copyFrom, tagStart), " ");
    copyFrom = regionEnd;
    cursor = regionEnd;
  }
  output.push(html.slice(copyFrom));
  return output.join("");
}

function isAdSlotContainerTag(name: string, tagText: string) {
  if (AD_SLOT_BARE_TAG_NAMES.has(name)) {
    return true;
  }
  return tagCarriesAdSlotMarker(tagText);
}

function tagCarriesAdSlotMarker(tagText: string) {
  if (tagCarriesAdSlotDataAttribute(tagText)) {
    return true;
  }
  const id = readAttributeValue(tagText, "id") ?? "";
  const className = readAttributeValue(tagText, "class") ?? "";
  const tokens = `${id} ${className}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return tokens.some((token) => AD_SLOT_MARKER_TOKENS.has(token));
}

// Google Ad Manager emits ad slots as bare `<div>` (or `<amp-ad>`) elements
// with attribute names like `data-ad-slot` and no id/class. The id/class
// token check above never sees them, so this path reads the tag's attribute
// NAMES only — the values are numeric slot IDs / client codes, never copy.
// Only the attribute names in AD_SLOT_DATA_ATTRIBUTE_NAMES matter; an empty
// attribute (e.g. `data-ad-slot`) keeps the marker because the page itself
// declared the slot.
function tagCarriesAdSlotDataAttribute(tagText: string) {
  for (const attribute of AD_SLOT_DATA_ATTRIBUTE_NAMES) {
    if (hasAttributeName(tagText, attribute)) {
      return true;
    }
  }
  return false;
}

/** Return the index just past the closing tag, or null when never closed. */
function findOpaqueContainerEnd(
  html: string,
  tagStart: number,
  name: string,
) {
  let cursor = tagStart + 1;
  let depth = 1;
  while (cursor < html.length) {
    const nextTag = html.indexOf("<", cursor);
    if (nextTag < 0) return null;
    const parsedTag = readHtmlTag(html, nextTag);
    const tag = parsedTag.tag;
    cursor = parsedTag.nextCursor;
    if (!tag || tag.name !== name) continue;
    if (tag.closing) {
      depth -= 1;
      if (depth === 0) {
        return parsedTag.nextCursor;
      }
      continue;
    }
    // Only templates nest legitimately; script/style use first-close-wins
    // (a "<script>" inside a JS string is not a real element).
    if (name === "template") {
      depth += 1;
    }
  }
  return null;
}

/**
 * Find the end of an ad-slot region opened at tagStart. Same-name nesting is
 * tracked; script/style/template subtrees inside the region are skipped
 * opaquely. Returns null (fail safe) when no closing tag appears within the
 * scan bound.
 */
function findAdSlotRegionEnd(
  html: string,
  tagStart: number,
  name: string,
  afterOpenTag: number,
) {
  let cursor = afterOpenTag;
  let depth = 1;
  while (cursor < html.length) {
    if (cursor - tagStart > AD_SLOT_REGION_SCAN_LIMIT) {
      return null;
    }
    const nextTag = html.indexOf("<", cursor);
    if (nextTag < 0) return null;
    if (nextTag - tagStart > AD_SLOT_REGION_SCAN_LIMIT) {
      return null;
    }
    const parsedTag = readHtmlTag(html, nextTag);
    const tag = parsedTag.tag;
    cursor = parsedTag.nextCursor;
    if (!tag) continue;
    if (tag.closing && tag.name === name) {
      depth -= 1;
      if (depth === 0) {
        return parsedTag.nextCursor;
      }
      continue;
    }
    if (!tag.closing && tag.name === name) {
      depth += 1;
      continue;
    }
    if (!tag.closing && AD_SLOT_OPAQUE_TAG_NAMES.has(tag.name)) {
      const opaqueEnd = findOpaqueContainerEnd(html, nextTag, tag.name);
      if (opaqueEnd !== null) {
        cursor = opaqueEnd;
      }
    }
  }
  return null;
}

function readAttributeValue(tagText: string, attribute: string) {
  const pattern = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\\`]+))`,
    "i",
  );
  const match = tagText.match(pattern);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? "";
}

// Presence-only attribute check (no value required). Walks the tag text
// outside quoted regions so an attribute name that appears inside a class
// value (`class="data-ad-slot is hidden"`) never falsely matches. Boolean
// attributes (`<div data-ad-slot>`) are recognised because we only check
// the name — the value is meaningless for ad-slot identification.
function hasAttributeName(tagText: string, name: string) {
  const lower = name.toLowerCase();
  let cursor = 0;
  if (tagText[cursor] === "<") cursor += 1;
  while (cursor < tagText.length && /[a-z0-9:_-]/i.test(tagText[cursor] ?? "")) {
    cursor += 1;
  }
  while (cursor < tagText.length) {
    const ch = tagText[cursor];
    if (ch === '"' || ch === "'") {
      const end = tagText.indexOf(ch, cursor + 1);
      if (end < 0) return false;
      cursor = end + 1;
      continue;
    }
    if (ch === ">") return false;
    if (/\s/.test(ch ?? "")) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < tagText.length && /[a-z0-9:_-]/i.test(tagText[cursor] ?? "")) {
      cursor += 1;
    }
    if (tagText.slice(start, cursor).toLowerCase() === lower) {
      return true;
    }
    while (cursor < tagText.length) {
      const next = tagText[cursor];
      if (next === '"' || next === "'" || /\s/.test(next ?? "") || next === ">") {
        break;
      }
      cursor += 1;
    }
  }
  return false;
}

function extractButtonText(html: string) {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((match) => stripTags(match[1] ?? ""));
}

function extractSubmitValues(html: string) {
  return extractHtmlStartTags(html, "input")
    .filter((tag) => readAttribute(tag, "type")?.toLowerCase() === "submit")
    .map((tag) => readAttribute(tag, "value") ?? "");
}

function extractActionLinks(html: string) {
  return [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => stripTags(match[1] ?? ""));
}

function pickBestCta(candidates: string[]) {
  const unique = [...new Set(candidates.filter(Boolean))];

  for (const pattern of CTA_PRIORITY_PATTERNS) {
    const match = unique.find((candidate) => pattern.test(candidate));
    if (match) {
      return match;
    }
  }

  return null;
}

function pickPrice(html: string) {
  const text = cleanText(stripTags(html));

  for (const pattern of PRICE_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanText(match[1]);
    }
  }

  return null;
}

function detectFormPresence(html: string) {
  if (/<form\b/i.test(html)) {
    return true;
  }

  const inputTags = extractHtmlStartTags(html, "input");
  const hasLeadInputs = [
    ...inputTags,
    ...extractHtmlStartTags(html, "textarea"),
  ].some((tag) =>
    [
      readAttribute(tag, "type"),
      readAttribute(tag, "name"),
      readAttribute(tag, "placeholder"),
      readAttribute(tag, "autocomplete"),
      readAttribute(tag, "aria-label"),
      readAttribute(tag, "id"),
    ].some(isLeadFieldValue),
  );
  const hasSubmitAction =
    inputTags.some(
      (tag) => readAttribute(tag, "type")?.toLowerCase() === "submit",
    ) ||
    extractHtmlStartTags(html, "button").some(
      (tag) => readAttribute(tag, "type")?.toLowerCase() === "submit",
    );

  return hasLeadInputs && hasSubmitAction;
}

function isLeadFieldValue(value: string | null) {
  if (!value) return false;
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
  return LEAD_FIELD_PATTERN.test(normalized);
}

function extractHtmlStartTags(html: string, tagName: string) {
  const tags: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;
    const parsedTag = readHtmlTag(html, tagStart);
    const tag = parsedTag.tag;
    if (!tag) {
      cursor = parsedTag.nextCursor;
      continue;
    }
    if (!tag.closing && tag.name === tagName) {
      tags.push(html.slice(tagStart, tag.end));
    }
    cursor = parsedTag.nextCursor;
  }
  return tags;
}

function readHtmlTag(
  html: string,
  start: number,
  maxScanLength = MAX_HTML_TAG_SCAN_LENGTH,
  recoverNestedTagStarts = true,
  preferredClosingTagName: string | null = null,
) {
  const prefix = readHtmlTagPrefix(html, start);
  if (!prefix) {
    return {
      nextCursor: Math.min(html.length, start + 1),
      tag: null,
    };
  }
  const { closing, name, nameEnd, nameStart } = prefix;
  let cursor = nameEnd;

  let quote: "\"" | "'" | null = null;
  let preferredClosingTagRecoveryStart: number | null = null;
  let hiddenTagRecoveryStart: number | null = null;
  let nestedTagRecoveryStart: number | null = null;
  const scanLimit = Math.min(html.length, cursor + maxScanLength);
  for (; cursor < scanLimit; cursor += 1) {
    const character = html[cursor];
    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }
      const nestedPrefix =
        recoverNestedTagStarts && character === "<"
          ? readHtmlTagPrefix(html, cursor)
          : null;
      if (nestedPrefix) {
        // A less-than sequence is legal inside a quoted attribute. Remember
        // it only as a recovery point; use it if the containing tag never
        // closes, otherwise keep the attribute intact. Retaining the latest
        // point also keeps repeated malformed prefixes linear.
        nestedTagRecoveryStart = cursor;
        if (
          preferredClosingTagRecoveryStart === null &&
          nestedPrefix.closing &&
          nestedPrefix.name === preferredClosingTagName
        ) {
          preferredClosingTagRecoveryStart = cursor;
        }
        if (
          hiddenTagRecoveryStart === null &&
          !nestedPrefix.closing &&
          HIDDEN_RECOVERY_TAG_NAMES.has(nestedPrefix.name)
        ) {
          hiddenTagRecoveryStart = cursor;
        }
      }
      continue;
    }
    const nestedPrefix =
      recoverNestedTagStarts && character === "<"
        ? readHtmlTagPrefix(html, cursor)
        : null;
    if (nestedPrefix) {
      // Browsers keep "<" in unquoted attribute values, so do not abort a
      // tag that later closes. This point is used only if the bounded scan
      // fails, preserving tags that begin near the end of that window.
      nestedTagRecoveryStart = cursor;
      if (
        preferredClosingTagRecoveryStart === null &&
        nestedPrefix.closing &&
        nestedPrefix.name === preferredClosingTagName
      ) {
        preferredClosingTagRecoveryStart = cursor;
      }
      if (
        hiddenTagRecoveryStart === null &&
        !nestedPrefix.closing &&
        HIDDEN_RECOVERY_TAG_NAMES.has(nestedPrefix.name)
      ) {
        hiddenTagRecoveryStart = cursor;
      }
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character !== ">") continue;

    let beforeEnd = cursor - 1;
    while (beforeEnd > nameStart && /\s/.test(html[beforeEnd] ?? "")) {
      beforeEnd -= 1;
    }
    return {
      nextCursor: cursor + 1,
      tag: {
        closing,
        end: cursor + 1,
        name,
        selfClosing: !closing && html[beforeEnd] === "/",
      },
    };
  }

  return {
    nextCursor:
      preferredClosingTagRecoveryStart ??
      hiddenTagRecoveryStart ??
      nestedTagRecoveryStart ??
      scanLimit,
    tag: null,
  };
}

function readHtmlTagPrefix(html: string, start: number) {
  let cursor = start + 1;
  const closing = html[cursor] === "/";
  if (closing) cursor += 1;

  const nameStart = cursor;
  while (cursor < html.length && /[a-z0-9:_-]/i.test(html[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor === nameStart) return null;
  return {
    closing,
    name: html.slice(nameStart, cursor).toLowerCase(),
    nameEnd: cursor,
    nameStart,
  };
}

function readAttribute(
  tag: string,
  attribute:
    | "type"
    | "value"
    | "name"
    | "placeholder"
    | "autocomplete"
    | "aria-label"
    | "id",
) {
  for (const match of tag.matchAll(
    /\b([a-z][a-z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
  )) {
    if (match[1]?.toLowerCase() === attribute) {
      return match[2] ?? match[3] ?? match[4] ?? "";
    }
  }
  return null;
}

function stripTags(value: string) {
  const output: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const tagStart = value.indexOf("<", cursor);
    if (tagStart < 0) {
      output.push(value.slice(cursor));
      break;
    }
    output.push(value.slice(cursor, tagStart), " ");
    const tagEnd = value.indexOf(">", tagStart + 1);
    if (tagEnd < 0) break;
    cursor = tagEnd + 1;
  }
  return output.join("");
}

function cleanText(value: string) {
  return decodeHtml(value).replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value.replace(
    /&(amp|quot|#39|lt|gt|hellip|#8230|#x2026);/gi,
    (entity) => {
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&quot;":
          return '"';
        case "&#39;":
          return "'";
        case "&lt;":
          return "<";
        case "&gt;":
          return ">";
        default:
          return "…";
      }
    },
  );
}
