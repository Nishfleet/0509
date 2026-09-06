import { classifyLanguage } from "~/lib/language-classifier";
import type { AppEnv } from "~/lib/env.server";
import type { AdRecord, AnalysisFieldInput } from "~/lib/types";

export const TRANSLATION_MODEL = "@cf/meta/m2m100-1.2b";
export const TRANSLATION_EXTRACTOR_VERSION = "translated-text-v1";

export const LANGUAGE_DETECT_MODEL = "@cf/meta/llama-3.2-3b-instruct";

const TARGET_LANGUAGE_CODE = "en";
const AMBIGUOUS_LATIN_DIACRITICS = /[\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u1E00-\u1EFF]/;
const AMBIGUOUS_SHORT_SAMPLE_LENGTH = 80;
const OBVIOUS_ENGLISH_WORDS =
  /\b(?:the|and|your|you|with|off|now|get|free|our|for|this|today|new|shop|sale|buy|save|only|all)\b/i;
const DETECTION_CACHE_LIMIT = 500;
const detectionCache = new Map<string, string | null>();
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

const GLOBAL_SCRIPT_LANGUAGE_CODES: Record<string, string> = {
  arabic: "ar",
  hebrew: "he",
  cyrillic: "ru",
  greek: "el",
  thai: "th",
  han: "zh",
  hiragana: "ja",
  katakana: "ja",
  hangul: "ko",
  ethiopic: "am",
};

const LATIN_LABEL_LANGUAGE_CODES: Record<string, string> = {
  Spanish: "es",
  Portuguese: "pt",
  French: "fr",
  German: "de",
  Italian: "it",
  Dutch: "nl",
  Turkish: "tr",
  Polish: "pl",
  Indonesian: "id",
  Vietnamese: "vi",
  Swahili: "sw",
  Afrikaans: "af",
  Hausa: "ha",
  Yoruba: "yo",
};

const SUPPORTED_DETECTED_CODES = new Set([
  "hi",
  ...Object.values(REGIONAL_SCRIPT_LANGUAGE_CODES),
  ...Object.values(GLOBAL_SCRIPT_LANGUAGE_CODES),
  ...Object.values(LATIN_LABEL_LANGUAGE_CODES),
]);

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
  if (!env.AI || findTranslatedAnalysisField(ad.analysisFields)) {
    return null;
  }

  const sourceText = buildTranslationInput(ad);
  if (!sourceText) {
    return null;
  }

  let sourceLanguageCode: string | null = null;
  let detectionProvider: string | null = null;

  if (shouldTranslateAd(ad)) {
    sourceLanguageCode = resolveSourceLanguageCode(ad, sourceText);
  } else if (ad.languageLabel === "English" && hasAmbiguousLatinSignals(sourceText)) {
    const detected = await detectLanguageCode(env, sourceText);
    if (detected && detected !== TARGET_LANGUAGE_CODE && SUPPORTED_DETECTED_CODES.has(detected)) {
      sourceLanguageCode = detected;
      detectionProvider = LANGUAGE_DETECT_MODEL;
    }
  }

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
        ...(detectionProvider ? { languageDetectionModel: detectionProvider } : {}),
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
  return ad.languageLabel !== "English" && ad.languageLabel !== "Unknown";
}

export function hasAmbiguousLatinSignals(sample: string) {
  if (AMBIGUOUS_LATIN_DIACRITICS.test(sample)) {
    return true;
  }

  const compact = sample.replace(/\s+/g, " ").trim();
  return compact.length < AMBIGUOUS_SHORT_SAMPLE_LENGTH && !OBVIOUS_ENGLISH_WORDS.test(compact);
}

async function detectLanguageCode(env: Pick<AppEnv, "AI">, sample: string) {
  if (!env.AI) {
    return null;
  }

  const cacheKey = sample.slice(0, 200);
  if (detectionCache.has(cacheKey)) {
    return detectionCache.get(cacheKey) ?? null;
  }

  try {
    const response = await env.AI.run(LANGUAGE_DETECT_MODEL, {
      messages: [
        {
          role: "system",
          content:
            "You identify the primary language of advertising text. Respond with ONLY the two-letter ISO 639-1 language code, nothing else.",
        },
        { role: "user", content: sample.slice(0, 400) },
      ],
      max_tokens: 5,
    });
    const raw =
      typeof response === "string"
        ? response
        : typeof (response as { response?: unknown }).response === "string"
          ? ((response as { response: string }).response)
          : "";
    const match = raw.trim().toLowerCase().match(/^[a-z]{2}/);
    const detected = match ? match[0] : null;
    rememberDetection(cacheKey, detected);
    return detected;
  } catch {
    return null;
  }
}

function rememberDetection(key: string, value: string | null) {
  if (detectionCache.size >= DETECTION_CACHE_LIMIT) {
    const oldest = detectionCache.keys().next().value;
    if (oldest !== undefined) {
      detectionCache.delete(oldest);
    }
  }
  detectionCache.set(key, value);
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

  const latinCode = LATIN_LABEL_LANGUAGE_CODES[ad.languageLabel];
  if (latinCode) {
    return latinCode;
  }

  if (ad.languageLabel !== "Regional" && ad.languageLabel !== "Global") {
    return null;
  }

  const scriptCodes =
    ad.languageLabel === "Regional" ? REGIONAL_SCRIPT_LANGUAGE_CODES : GLOBAL_SCRIPT_LANGUAGE_CODES;
  const classification = classifyLanguage({
    previewHeadline: sample,
    body: sample,
  });
  const scriptSignals = classification.metadata.scriptSignals;

  if (
    ad.languageLabel === "Global" &&
    (scriptSignals.hiragana ?? 0) + (scriptSignals.katakana ?? 0) > 0
  ) {
    return "ja";
  }

  const matchedScript = Object.entries(scriptCodes)
    .sort((left, right) => (scriptSignals[right[0]] ?? 0) - (scriptSignals[left[0]] ?? 0))
    .find(([script]) => (scriptSignals[script] ?? 0) > 0)?.[0];

  return matchedScript ? scriptCodes[matchedScript] : null;
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
