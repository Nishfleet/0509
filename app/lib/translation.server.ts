import { classifyLanguage } from "~/lib/language-classifier";
import type { AppEnv } from "~/lib/env.server";
import type { AdRecord, AnalysisFieldInput } from "~/lib/types";

export const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
export const TRANSLATION_EXTRACTOR_VERSION = "translated-text-v1";

const TARGET_LANGUAGE_CODE = "en";
const MAX_TRANSLATION_INPUT_LENGTH = 1600;
const REGIONAL_SCRIPT_LANGUAGE_CODES: Record<string, string> = {
  bengali: "bn",
  gujarati: "gu",
  gurmukhi: "pa",
  kannada: "kn",
  malayalam: "ml",
  odia: "or",
  tamil: "ta",
  telugu: "te",
};

type TranslationCandidateAd = Pick<
  AdRecord,
  | "analysisFields"
  | "body"
  | "bodySecondary"
  | "creativeText"
  | "languageLabel"
  | "previewHeadline"
  | "previewSubhead"
>;

export interface TranslationResult {
  text: string;
  metadata: Record<string, unknown>;
}

export async function translateAdText(
  env: Pick<AppEnv, "AI">,
  ad: TranslationCandidateAd,
): Promise<TranslationResult | null> {
  if (!env.AI || !shouldTranslateAd(ad)) {
    return null;
  }

  const sourceText = buildTranslationInput(ad);
  if (!sourceText) {
    return null;
  }

  const sourceLanguageCode = resolveSourceLanguageCode(ad, sourceText);
  if (!sourceLanguageCode) {
    return null;
  }

  try {
    const response = await env.AI.run(TRANSLATION_MODEL, {
      text: sourceText,
      source_lang: sourceLanguageCode,
      target_lang: TARGET_LANGUAGE_CODE,
    });
    const translatedText = normalizeTranslationResponse(response);

    if (!translatedText || translatedText.toLowerCase() === sourceText.toLowerCase()) {
      return null;
    }

    return {
      text: translatedText,
      metadata: {
        provider: "workers_ai",
        model: TRANSLATION_MODEL,
        sourceLanguageCode,
        sourceLanguageLabel: ad.languageLabel,
        targetLanguageCode: TARGET_LANGUAGE_CODE,
      },
    };
  } catch {
    return null;
  }
}

export function buildTranslatedAnalysisField(
  result: TranslationResult,
): AnalysisFieldInput {
  return {
    scopeType: "ad",
    fieldKey: "translated_text",
    fieldValue: result.text,
    provenanceSource: "ai_summary",
    extractorVersion: TRANSLATION_EXTRACTOR_VERSION,
    confidence: 0.68,
    metadata: result.metadata,
  };
}

export function findTranslatedAnalysisField(
  fields: AnalysisFieldInput[],
): AnalysisFieldInput | null {
  return fields.find(
    (field) => field.fieldKey === "translated_text" && field.fieldValue.trim(),
  ) ?? null;
}

export function withTranslatedAnalysisField(
  fields: AnalysisFieldInput[],
  translatedField: AnalysisFieldInput | null,
) {
  const remaining = fields.filter((field) => field.fieldKey !== "translated_text");

  return translatedField ? [...remaining, translatedField] : remaining;
}

function shouldTranslateAd(ad: TranslationCandidateAd) {
  if (findTranslatedAnalysisField(ad.analysisFields)) {
    return false;
  }

  return ad.languageLabel === "Hindi" || ad.languageLabel === "Hinglish" || ad.languageLabel === "Regional";
}

function buildTranslationInput(ad: TranslationCandidateAd) {
  const seen = new Set<string>();
  const lines: string[] = [];
  const candidates = [
    ad.creativeText,
    ad.previewHeadline,
    ad.previewSubhead,
    ad.body,
    ad.bodySecondary,
  ];

  for (const candidate of candidates) {
    for (const line of splitTranslationLines(candidate)) {
      const normalized = normalizeLineForDedup(line);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      if (lines.join("\n").length + line.length > MAX_TRANSLATION_INPUT_LENGTH) {
        return lines.join("\n").trim() || null;
      }

      seen.add(normalized);
      lines.push(line);
    }
  }

  return lines.join("\n").trim() || null;
}

function splitTranslationLines(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeLineForDedup(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function resolveSourceLanguageCode(ad: TranslationCandidateAd, sample: string) {
  if (ad.languageLabel === "Hindi" || ad.languageLabel === "Hinglish") {
    return "hi";
  }

  if (ad.languageLabel !== "Regional") {
    return null;
  }

  const classification = classifyLanguage({
    previewHeadline: sample,
    body: sample,
  });
  const scriptSignals = classification.metadata.scriptSignals;
  const regionalScript = Object.entries(REGIONAL_SCRIPT_LANGUAGE_CODES)
    .sort((left, right) => (scriptSignals[right[0]] ?? 0) - (scriptSignals[left[0]] ?? 0))
    .find(([script]) => (scriptSignals[script] ?? 0) > 0)?.[0];

  return regionalScript ? REGIONAL_SCRIPT_LANGUAGE_CODES[regionalScript] : null;
}

function normalizeTranslationResponse(response: unknown) {
  const translatedText =
    typeof response === "object" &&
    response !== null &&
    "translated_text" in response &&
    typeof response.translated_text === "string"
      ? response.translated_text
      : "";

  return translatedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
