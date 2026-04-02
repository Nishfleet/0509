const ROMANIZED_HINDI_CUE_WORDS = [
  "aaj",
  "abhi",
  "aap",
  "apna",
  "apne",
  "apni",
  "aur",
  "bas",
  "bhi",
  "bilkul",
  "combo",
  "dekho",
  "dhamaka",
  "ghar",
  "hai",
  "hain",
  "jaldi",
  "kar",
  "karo",
  "karlo",
  "karna",
  "karne",
  "kya",
  "kyunki",
  "lelo",
  "lo",
  "milega",
  "milta",
  "naya",
  "nayi",
  "naye",
  "paise",
  "sabse",
  "sahi",
  "sasta",
  "sasti",
  "sirf",
  "waala",
  "waali",
  "wala",
  "wali",
  "yahaan",
  "yahi",
  "ya",
  "zyada",
] as const;

const SCRIPT_PATTERNS = {
  latin: /[A-Za-z]/g,
  devanagari: /[\u0900-\u097F]/g,
  bengali: /[\u0980-\u09FF]/g,
  gurmukhi: /[\u0A00-\u0A7F]/g,
  gujarati: /[\u0A80-\u0AFF]/g,
  odia: /[\u0B00-\u0B7F]/g,
  tamil: /[\u0B80-\u0BFF]/g,
  telugu: /[\u0C00-\u0C7F]/g,
  kannada: /[\u0C80-\u0CFF]/g,
  malayalam: /[\u0D00-\u0D7F]/g,
} as const;

export type LanguageLabel = "English" | "Hinglish" | "Hindi" | "Regional" | "Unknown";

export interface LanguageClassification {
  label: LanguageLabel;
  confidence: number;
  metadata: {
    sampleLength: number;
    scriptSignals: Record<string, number>;
    cueMatches: string[];
    decisionReason: string;
  };
}

export function classifyLanguage(input: {
  previewHeadline?: string | null;
  body?: string | null;
  previewSubhead?: string | null;
  landingPageHeadline?: string | null;
}): LanguageClassification {
  const sample = [
    input.previewHeadline?.trim(),
    input.body?.trim(),
    input.previewSubhead?.trim(),
    input.landingPageHeadline?.trim(),
  ]
    .filter(Boolean)
    .join(" \n ");

  const scriptSignals = countScripts(sample);
  const cueMatches = findCueMatches(sample);
  const cueScore = countCueEvidence(sample);
  const sampleLength = sample.replace(/\s+/g, " ").trim().length;
  const totalAlpha =
    scriptSignals.latin +
    scriptSignals.devanagari +
    scriptSignals.bengali +
    scriptSignals.gurmukhi +
    scriptSignals.gujarati +
    scriptSignals.odia +
    scriptSignals.tamil +
    scriptSignals.telugu +
    scriptSignals.kannada +
    scriptSignals.malayalam;
  const regionalSignals =
    scriptSignals.bengali +
    scriptSignals.gurmukhi +
    scriptSignals.gujarati +
    scriptSignals.odia +
    scriptSignals.tamil +
    scriptSignals.telugu +
    scriptSignals.kannada +
    scriptSignals.malayalam;

  if (sampleLength < 15 || totalAlpha < 8) {
    return buildResult("Unknown", 0.24, sampleLength, scriptSignals, cueMatches, "insufficient_signal");
  }

  if (regionalSignals >= 3 && regionalSignals > scriptSignals.devanagari && regionalSignals >= scriptSignals.latin / 5) {
    return buildResult("Regional", 0.88, sampleLength, scriptSignals, cueMatches, "regional_script_detected");
  }

  if (scriptSignals.devanagari >= 4 && scriptSignals.devanagari >= regionalSignals) {
    const confidence = scriptSignals.latin > 8 ? 0.78 : 0.92;
    return buildResult("Hindi", confidence, sampleLength, scriptSignals, cueMatches, "devanagari_dominant");
  }

  if (scriptSignals.latin >= 10 && cueScore >= 2) {
    const confidence = Math.min(0.94, 0.62 + cueScore * 0.06);
    return buildResult("Hinglish", confidence, sampleLength, scriptSignals, cueMatches, "latin_with_hinglish_cues");
  }

  if (scriptSignals.latin >= 10) {
    return buildResult("English", 0.79, sampleLength, scriptSignals, cueMatches, "latin_without_hinglish_cues");
  }

  return buildResult("Unknown", 0.35, sampleLength, scriptSignals, cueMatches, "conflicting_or_weak_signal");
}

function buildResult(
  label: LanguageLabel,
  confidence: number,
  sampleLength: number,
  scriptSignals: Record<string, number>,
  cueMatches: string[],
  decisionReason: string,
): LanguageClassification {
  return {
    label,
    confidence,
    metadata: {
      sampleLength,
      scriptSignals,
      cueMatches,
      decisionReason,
    },
  };
}

function countScripts(sample: string) {
  return Object.fromEntries(
    Object.entries(SCRIPT_PATTERNS).map(([key, pattern]) => [key, sample.match(pattern)?.length ?? 0]),
  );
}

function findCueMatches(sample: string) {
  const lower = sample.toLowerCase();
  return ROMANIZED_HINDI_CUE_WORDS.filter((word) => new RegExp(`\\b${escapeRegex(word)}\\b`, "i").test(lower));
}

function countCueEvidence(sample: string) {
  const lower = sample.toLowerCase();
  return ROMANIZED_HINDI_CUE_WORDS.reduce((total, word) => {
    const matches = lower.match(new RegExp(`\\b${escapeRegex(word)}\\b`, "gi"));
    return total + (matches?.length ?? 0);
  }, 0);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
