import { mapAdSourceToAnalysisSource } from "~/lib/ad-source-kind";
import { LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION } from "~/lib/landing-page-signals.server";
import { classifyLanguage } from "~/lib/language-classifier";
import { CREATIVE_TEXT_EXTRACTOR_VERSION } from "~/lib/creative-text.server";
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
const offerPattern =
  /((?:up ?to )?\d+% ?off|buy ?\d+ get ?\d+|free shipping|cod|launch pricing|rs ?\d+[^\s,.]* off|free minis?)/i;

export function inferLanguageLabel(value: string) {
  return classifyLanguage({
    previewHeadline: value,
  }).label;
}

export function inferDestinationType(url: string | null): DestinationType {
  if (!url) {
    return "unknown";
  }

  const normalized = url.toLowerCase();
  if (normalized.includes("wa.me") || normalized.includes("whatsapp")) {
    return "whatsapp";
  }
  if (normalized.includes("play.google.com") || normalized.includes("appstore.com")) {
    return "app";
  }
  if (normalized.includes("lead") || normalized.includes("form")) {
    return "lead_form";
  }

  return "website";
}

export function deriveHook(body: string, fallbackHeadline: string) {
  const firstSentence = body
    .split(/[.!?]/)
    .map((part) => part.trim())
    .find(Boolean);

  return firstSentence ?? fallbackHeadline;
}

export function deriveOffer(body: string, fallbackCta: string) {
  const match = body.match(offerPattern);
  return match?.[0] ?? fallbackCta;
}

export function buildAnalysisFields(ad: AdRecord, source: AnalysisSource): AnalysisFieldInput[] {
  const landingPageSource = ad.landingPage ? mapCaptureMethodToSource(ad.landingPage.captureMethod) : source;
  const language = classifyAdLanguage(ad);
  const fields = [
    createField("hook", ad.hook, source, 0.86),
    createField("offer", ad.offer, source, 0.84),
    createField("cta", ad.cta, source, 0.96),
    createField("format", ad.format, source, 0.98),
    createField("language_label", language.label, source, language.confidence, language.metadata),
    createField("destination_type", ad.destinationType, source, 0.9),
    createField("landing_page_url", ad.landingPageUrl ?? "", source, 0.99),
    createField(
      "landing_page_headline_summary",
      ad.landingPage?.rawHeadline ?? "",
      landingPageSource,
      ad.landingPage ? 0.92 : 0.2,
    ),
  ];

  if (ad.landingPage) {
    const landingPageFields = buildLandingPageAnalysisFields(ad.landingPage);
    fields.push(...landingPageFields.map((field) => ({ ...field, scopeType: "ad" as const })));
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

export function withStructuredAnalysis(ad: Omit<AdRecord, "analysisFields">): AdRecord {
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
  ad: Pick<AdRecord, "previewHeadline" | "body" | "previewSubhead" | "landingPage">,
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
    fields.push(createLandingPageField("cta_text", snapshot.ctaText, provenanceSource, 0.82));
  }

  if (snapshot.priceText) {
    fields.push(createLandingPageField("price_text", snapshot.priceText, provenanceSource, 0.84));
  }

  if (typeof snapshot.formPresent === "boolean") {
    fields.push(
      createLandingPageField(
        "form_present",
        snapshot.formPresent ? "true" : "false",
        provenanceSource,
        0.92,
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
): AnalysisFieldInput {
  return {
    scopeType: "landing_page",
    fieldKey,
    fieldValue,
    provenanceSource,
    extractorVersion: LANDING_PAGE_SIGNALS_EXTRACTOR_VERSION,
    confidence,
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
