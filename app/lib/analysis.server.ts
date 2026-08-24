import { mapAdSourceToAnalysisSource } from "~/lib/ad-source-kind";
import { LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION } from "~/lib/landing-page-signals.server";
import { classifyLanguage } from "~/lib/language-classifier";
import { CREATIVE_TEXT_EXTRACTOR_VERSION } from "~/lib/creative-text.server";
import { truncateTextSafe } from "~/lib/text-safe";
import type {
  AdRecord,
  AnalysisFieldInput,
  AnalysisSource,
  CreativeTextCaptureMethod,
  DestinationType,
  LandingPageSnapshotData,
} from "~/lib/types";

const EXTRACTOR_VERSION = "v1-structured-analysis";

const devnagariPattern = /[\u0900-\u097F]/;
/**
 * Promo/price phrases across major currencies — return null when none match.
 * FIX-3: do not put multi-char tokens (R$, zł) inside a character class — that
 * decomposes them so bare "r"/"z" before digits and "Bogotá"/"code" match.
 */
const offerPattern =
  /\b(?:(?:(?:up\s*to|upto|flat)\s*)?\d+\s*%\s*off|buy\s*\d+\s*get\s*\d+|bogo|free\s+(?:shipping|delivery|minis?)|sale\s+ends?|deal\s+ends?|launch\s+pricing|cod)\b|\b(?:from|starting\s+at)\s*(?:R\$|zł|[₹$€£¥])\s*\d[\d,.]*|(?:R\$|zł|[₹$€£¥])\s*\d[\d,.]*(?:\s*off\b)?|\b(?:rs\.?|inr)\s*\d[\d,.]*(?:\s*off\b)?/i;
const HOOK_MAX_CHARS = 120;

export function inferLanguageLabel(value: string) {
  return classifyLanguage({
    previewHeadline: value,
  }).label;
}

function isHostOrSubdomain(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

export function inferDestinationType(url: string | null): DestinationType {
  if (!url) {
    return "unknown";
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "unknown";
  }

  const host = parsed.hostname;
  if (
    isHostOrSubdomain(host, "play.google.com") ||
    isHostOrSubdomain(host, "appstore.com")
  ) {
    return "app";
  }
  if (
    isHostOrSubdomain(host, "wa.me") ||
    isHostOrSubdomain(host, "whatsapp.com") ||
    isHostOrSubdomain(host, "whatsapp")
  ) {
    return "whatsapp";
  }

  const pathAndQuery = (parsed.pathname + parsed.search).toLowerCase();
  if (pathAndQuery.includes("lead") || pathAndQuery.includes("form")) {
    return "lead_form";
  }

  return "website";
}

/** First sentence or first line of body, capped, emoji-run stripped. */
export function deriveHook(body: string, fallbackHeadline: string) {
  const source = (body || fallbackHeadline || "").trim();
  if (!source) {
    return "";
  }

  const firstLine = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  const firstLineSentence = firstLine
    ?.split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find(Boolean);
  const firstSentence = source
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .find(Boolean);
  // Prefer a short first line when the body is multi-line card chrome + copy.
  const candidate =
    firstLineSentence || firstSentence || firstLine || fallbackHeadline;

  return clampHook(stripHeavyEmojiRuns(candidate || fallbackHeadline || ""));
}

/**
 * Extract an explicit promo/price phrase. Returns null when none is found —
 * callers must not fall back to repeating the full body or CTA.
 */
export function deriveOffer(
  body: string,
  _fallbackCta?: string,
): string | null {
  const source = (body || "").trim();
  if (!source) {
    return null;
  }

  const match = source.match(offerPattern);
  if (!match?.[0]) {
    return null;
  }

  return match[0].replace(/\s+/g, " ").trim();
}

/** Ensure hook and offer never display as identical copy-paste strings. */
export function resolveHookAndOffer(input: {
  body: string;
  previewHeadline: string;
  cta?: string;
}): { hook: string; offer: string } {
  const hook = deriveHook(input.body, input.previewHeadline);
  const offer = deriveOffer(input.body, input.cta) ?? "";
  return { hook, offer };
}

/**
 * Compose a research line from real signals only. Missing fields are omitted
 * so two ads never share identical boilerplate when their signals differ.
 */
export function composeResearchSummary(
  ad: Pick<
    AdRecord,
    | "active"
    | "firstSeenAt"
    | "landingPageUrl"
    | "offer"
    | "format"
    | "platforms"
    | "countries"
    | "source"
  > & {
    variantCount?: number | null;
  },
): string {
  const parts: string[] = [];

  if (ad.active) {
    parts.push("Active");
  } else {
    parts.push("Inactive");
  }

  const runningDays = daysRunningSince(ad.firstSeenAt);
  if (runningDays !== null) {
    parts.push(
      runningDays === 1 ? "Running 1 day" : `Running ${runningDays} days`,
    );
  }

  if (ad.variantCount && ad.variantCount > 1) {
    parts.push(`${ad.variantCount} variants`);
  }

  if (ad.offer?.trim()) {
    parts.push(hasDiscountSignal(ad.offer) ? "discount offer" : "promo offer");
  }

  if (ad.format === "video") {
    parts.push("video creative");
  } else if (ad.format === "carousel") {
    parts.push("carousel creative");
  }

  const host = hostFromUrl(ad.landingPageUrl);
  if (host) {
    parts.push(`links to ${host}`);
  }

  if (ad.platforms.length > 0) {
    parts.push(ad.platforms.slice(0, 3).join("/"));
  }

  if (parts.length === 0) {
    return ad.source === "meta_library_browser"
      ? "Captured from the public Meta Ad Library."
      : "Normalized from live ad discovery.";
  }

  return parts.join(" · ");
}

function clampHook(value: string) {
  const trimmed = value.trim();
  if (trimmed.length <= HOOK_MAX_CHARS) {
    return trimmed;
  }
  // truncateTextSafe: never split a surrogate pair at the cut, or the hook
  // stores a lone surrogate that renders as the U+FFFD replacement character.
  return `${truncateTextSafe(trimmed, HOOK_MAX_CHARS - 1).trimEnd()}…`;
}

function stripHeavyEmojiRuns(value: string) {
  // Collapse runs of 3+ emoji-ish symbols to two so hooks stay readable.
  // truncateTextSafe: slicing a run mid-pair would orphan a surrogate half.
  return value.replace(
    /(\p{Extended_Pictographic}\uFE0F?\u200D?){3,}/gu,
    (match) => truncateTextSafe(match, 2),
  );
}

function daysRunningSince(firstSeenAt: string | null | undefined) {
  if (!firstSeenAt) {
    return null;
  }
  const started = Date.parse(firstSeenAt);
  if (!Number.isFinite(started)) {
    return null;
  }
  const days = Math.max(
    0,
    Math.floor((Date.now() - started) / (24 * 60 * 60 * 1000)),
  );
  return days;
}

function hasDiscountSignal(offer: string) {
  return /%|off|discount|sale|deal|free\s+(?:shipping|delivery)|bogo|buy\s*\d+/i.test(
    offer,
  );
}

function hostFromUrl(url: string | null | undefined) {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export {
  formatOfferDisplay,
  NO_EXPLICIT_OFFER_LABEL,
} from "~/lib/analysis-display";

export function buildAnalysisFields(
  ad: AdRecord,
  source: AnalysisSource,
): AnalysisFieldInput[] {
  const landingPageSource = ad.landingPage
    ? mapCaptureMethodToSource(ad.landingPage.captureMethod)
    : source;
  const language = classifyAdLanguage(ad);
  const fields = [
    ...(ad.hook.trim() ? [createField("hook", ad.hook, source, 0.86)] : []),
    ...(ad.offer.trim() ? [createField("offer", ad.offer, source, 0.84)] : []),
    createField("cta", ad.cta, source, 0.96),
    createField("format", ad.format, source, 0.98),
    createField(
      "language_label",
      language.label,
      source,
      language.confidence,
      language.metadata,
    ),
    createField("destination_type", ad.destinationType, source, 0.9),
    createField("landing_page_url", ad.landingPageUrl ?? "", source, 0.99),
    createField(
      "landing_page_headline_summary",
      ad.landingPage?.rawHeadline ?? "",
      landingPageSource,
      ad.landingPage ? 0.92 : 0.2,
      ad.landingPage ? { capturedAt: ad.landingPage.capturedAt } : undefined,
    ),
  ];

  if (ad.landingPage) {
    const landingPageFields = buildLandingPageAnalysisFields(ad.landingPage);
    fields.push(
      ...landingPageFields.map((field) => ({
        ...field,
        scopeType: "ad" as const,
      })),
    );
  }

  if (ad.creativeText) {
    fields.push(
      createField(
        "ocr_text",
        ad.creativeText,
        mapCreativeTextCaptureMethodToSource(ad.creativeTextCaptureMethod),
        0.72,
        {
          ...(ad.creativeTextMetadata ?? {}),
          captureMethod: ad.creativeTextCaptureMethod ?? "manual",
        },
        CREATIVE_TEXT_EXTRACTOR_VERSION,
      ),
    );
  }

  return fields;
}

export function withStructuredAnalysis(
  ad: Omit<AdRecord, "analysisFields">,
): AdRecord {
  const source = mapAdSourceToAnalysisSource(ad.source);
  const language = classifyAdLanguage(ad);
  const nextAd = {
    ...ad,
    languageLabel: language.label,
  };

  return {
    ...nextAd,
    analysisFields: buildAnalysisFields(nextAd as AdRecord, source),
  };
}

function createField(
  fieldKey: string,
  fieldValue: string,
  provenanceSource: AnalysisSource,
  confidence: number,
  metadata?: Record<string, unknown>,
  extractorVersion = EXTRACTOR_VERSION,
): AnalysisFieldInput {
  return {
    scopeType: "ad",
    fieldKey,
    fieldValue,
    provenanceSource,
    extractorVersion,
    confidence,
    metadata,
  };
}

function classifyAdLanguage(
  ad: Pick<
    AdRecord,
    "previewHeadline" | "body" | "previewSubhead" | "landingPage"
  >,
) {
  return classifyLanguage({
    previewHeadline: ad.previewHeadline,
    body: ad.body,
    previewSubhead: ad.previewSubhead,
    landingPageHeadline: ad.landingPage?.rawHeadline ?? null,
  });
}

export function buildLandingPageAnalysisFields(
  snapshot: LandingPageSnapshotData,
): AnalysisFieldInput[] {
  const provenanceSource = mapCaptureMethodToSource(snapshot.captureMethod);
  const fields: AnalysisFieldInput[] = [];

  if (snapshot.ctaText) {
    fields.push(
      createLandingPageField(
        "cta_text",
        snapshot.ctaText,
        provenanceSource,
        0.82,
        snapshot.capturedAt,
      ),
    );
  }

  if (snapshot.priceText) {
    fields.push(
      createLandingPageField(
        "price_text",
        snapshot.priceText,
        provenanceSource,
        0.84,
        snapshot.capturedAt,
      ),
    );
  }

  if (typeof snapshot.formPresent === "boolean") {
    fields.push(
      createLandingPageField(
        "form_present",
        snapshot.formPresent ? "true" : "false",
        provenanceSource,
        0.92,
        snapshot.capturedAt,
      ),
    );
  }

  return fields;
}

function createLandingPageField(
  fieldKey: string,
  fieldValue: string,
  provenanceSource: AnalysisSource,
  confidence: number,
  capturedAt: string,
): AnalysisFieldInput {
  return {
    scopeType: "landing_page",
    fieldKey,
    fieldValue,
    provenanceSource,
    extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    confidence,
    metadata: { capturedAt },
  };
}

function mapCaptureMethodToSource(
  captureMethod: LandingPageSnapshotData["captureMethod"],
): AnalysisSource {
  if (captureMethod === "browser_render") {
    return "browser_render";
  }

  if (captureMethod === "landing_page_fetch") {
    return "landing_page_fetch";
  }

  return "user";
}

function mapCreativeTextCaptureMethodToSource(
  captureMethod: CreativeTextCaptureMethod | null | undefined,
): AnalysisSource {
  if (captureMethod === "ad_snapshot_fetch") {
    return "ad_snapshot_fetch";
  }

  if (captureMethod === "browser_render") {
    return "browser_render";
  }

  return "user";
}
