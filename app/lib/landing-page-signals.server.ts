export const LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION = "lp-signals-v2";

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
  return cleanText(stripTags(bodyHtml)).length > 0;
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
    const tag = readHtmlTag(html, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }

    if (!hiddenElement) {
      if (!tag.closing && elementNames.has(tag.name)) {
        output.push(html.slice(copyFrom, tagStart), " ");
        copyFrom = tag.end;
        if (!tag.selfClosing) {
          hiddenElement = tag.name;
          hiddenDepth = 1;
        }
      }
    } else if (tag.name === hiddenElement) {
      if (
        hiddenElement === "template" &&
        !tag.closing &&
        !tag.selfClosing
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

    cursor = tag.end;
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
  ].some((tag) => /\b(name|email|phone|mobile|whatsapp)\b/i.test(tag));
  const hasSubmitAction =
    inputTags.some(
      (tag) => readAttribute(tag, "type")?.toLowerCase() === "submit",
    ) ||
    extractHtmlStartTags(html, "button").some(
      (tag) => readAttribute(tag, "type")?.toLowerCase() === "submit",
    );

  return hasLeadInputs && hasSubmitAction;
}

function extractHtmlStartTags(html: string, tagName: string) {
  const tags: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;
    const tag = readHtmlTag(html, tagStart);
    if (!tag) {
      cursor = tagStart + 1;
      continue;
    }
    if (!tag.closing && tag.name === tagName) {
      tags.push(html.slice(tagStart, tag.end));
    }
    cursor = tag.end;
  }
  return tags;
}

function readHtmlTag(html: string, start: number) {
  let cursor = start + 1;
  const closing = html[cursor] === "/";
  if (closing) cursor += 1;

  const nameStart = cursor;
  while (cursor < html.length && /[a-z0-9:_-]/i.test(html[cursor] ?? "")) {
    cursor += 1;
  }
  if (cursor === nameStart) return null;
  const name = html.slice(nameStart, cursor).toLowerCase();

  let quote: "\"" | "'" | null = null;
  const scanLimit = Math.min(html.length, cursor + 4_096);
  for (; cursor < scanLimit; cursor += 1) {
    const character = html[cursor];
    if (quote) {
      if (character === quote) quote = null;
      continue;
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
      closing,
      end: cursor + 1,
      name,
      selfClosing: !closing && html[beforeEnd] === "/",
    };
  }

  return null;
}

function readAttribute(tag: string, attribute: "type" | "value") {
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
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
