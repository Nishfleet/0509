export const LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION = "lp-signals-v3";

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
const SHELL_PLACEHOLDER_PATTERN =
  /^(?:loading(?:\s+(?:app|application))?(?:,\s*please wait)?|please wait|initializing)(?:[.!…]+)?$/i;

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

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;
    if (!hiddenElement && html.startsWith("<!--", tagStart)) {
      const commentEnd = html.indexOf("-->", tagStart + 4);
      output.push(html.slice(copyFrom, tagStart), " ");
      copyFrom = commentEnd < 0 ? html.length : commentEnd + 3;
      cursor = copyFrom;
      if (commentEnd < 0) break;
      continue;
    }
    const prefix = readHtmlTagPrefix(html, tagStart);
    const hiddenOpeningTag = Boolean(
      prefix &&
      !prefix.closing &&
      elementNames.has(prefix.name),
    );
    const parsedTag = readHtmlTag(
      html,
      tagStart,
      hiddenOpeningTag ? html.length - tagStart : undefined,
      !hiddenOpeningTag,
      hiddenElement,
    );
    const tag = parsedTag.tag;
    if (!tag) {
      if (hiddenOpeningTag) {
        if (!hiddenElement) {
          output.push(html.slice(copyFrom, tagStart), " ");
        }
        copyFrom = html.length;
        break;
      }
      cursor = parsedTag.nextCursor;
      continue;
    }

    if (!hiddenElement) {
      if (!tag.closing && elementNames.has(tag.name)) {
        output.push(html.slice(copyFrom, tagStart), " ");
        copyFrom = tag.end;
        // HTML ignores XHTML-style slashes on these non-void elements. An
        // empty <head/> is the exception here because browsers implicitly
        // close it at body flow even without a literal </head>.
        if (!tag.selfClosing || tag.name !== "head") {
          hiddenElement = tag.name;
          hiddenDepth = 1;
        }
      }
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
    output.push(html.slice(copyFrom));
  }
  return output.join("");
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
