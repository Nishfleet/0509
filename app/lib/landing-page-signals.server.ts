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

export function extractLandingPageSignals(html: string) {
  const normalizedHtml = removeNonVisibleElements(html ?? "");
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

function removeNonVisibleElements(html: string) {
  return html.replace(
    /<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    " ",
  );
}

function extractButtonText(html: string) {
  return [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((match) => stripTags(match[1] ?? ""));
}

function extractSubmitValues(html: string) {
  return [...html.matchAll(/<input\b[^>]*>/gi)]
    .map((match) => match[0])
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

  const hasLeadInputs =
    /<input\b[^>]*(name|email|phone|mobile|whatsapp)[^>]*>/i.test(html) ||
    /<(input|textarea)\b[^>]*(placeholder|name)=["'][^"']*(name|email|phone|mobile|whatsapp)[^"']*["'][^>]*>/i.test(
      html,
    );
  const hasSubmitAction =
    /<input\b[^>]*type=["']submit["'][^>]*>/i.test(html) ||
    /<button\b[^>]*type=["']submit["'][^>]*>/i.test(html);

  return hasLeadInputs && hasSubmitAction;
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
  return value.replace(/<[^>]+>/g, " ");
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
