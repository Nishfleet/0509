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
  arabic: /[\u0600-\u06FF]/g,
  hebrew: /[\u0590-\u05FF]/g,
  cyrillic: /[\u0400-\u04FF]/g,
  greek: /[\u0370-\u03FF]/g,
  thai: /[\u0E00-\u0E7F]/g,
  han: /[\u4E00-\u9FFF]/g,
  hiragana: /[\u3040-\u309F]/g,
  katakana: /[\u30A0-\u30FF]/g,
  hangul: /[\uAC00-\uD7AF]/g,
  ethiopic: /[\u1200-\u137F]/g,
} as const;

/**
 * True when `value` contains at least one character from any script family
 * tracked by this classifier (Latin, Indic, Arabic, CJK, Cyrillic, etc.).
 * Used by creative-text OCR candidate filtering so non-Latin overlays survive.
 */
export function hasClassifierScriptChar(value: string): boolean {
  return Object.values(SCRIPT_PATTERNS).some(
    (pattern) => (value.match(pattern)?.length ?? 0) > 0,
  );
}

const INDIC_SCRIPTS = [
  "bengali",
  "gurmukhi",
  "gujarati",
  "odia",
  "tamil",
  "telugu",
  "kannada",
  "malayalam",
] as const;

const GLOBAL_SCRIPTS = [
  "arabic",
  "hebrew",
  "cyrillic",
  "greek",
  "thai",
  "han",
  "hiragana",
  "katakana",
  "hangul",
  "ethiopic",
] as const;

interface LatinLanguageProfile {
  label: LatinLanguageLabel;
  cues: readonly string[];
  chars?: RegExp;
}

const LATIN_LANGUAGE_PROFILES: readonly LatinLanguageProfile[] = [
  {
    label: "Spanish",
    cues: [
      "que",
      "para",
      "con",
      "por",
      "ahora",
      "hoy",
      "descuento",
      "envio",
      "envío",
      "gratis",
      "oferta",
      "tienda",
      "nuevo",
      "mejor",
      "precio",
      "compra",
      "entra",
      "encuentra",
      "actualizaciones",
      "semanales",
      "producto",
      "productos",
      "y",
      "de",
      "el",
      "la",
      "los",
      "las",
      "una",
      "del",
      "al",
      "tu",
      "tus",
      "nuestro",
      "nuestra",
      "descubra",
      "descubre",
      "comprar",
    ],
    chars: /[ñ¿¡]/g,
  },
  {
    label: "Portuguese",
    cues: ["nao", "voce", "para", "com", "mais", "hoje", "desconto", "frete", "gratis", "oferta", "loja", "novo", "melhor", "preco", "agora", "compre"],
    chars: /[ãõç]/g,
  },
  {
    label: "French",
    cues: ["vous", "votre", "avec", "pour", "dans", "livraison", "gratuite", "maintenant", "offre", "remise", "achetez", "nouveau", "prix", "des", "chez"],
    chars: /[éèêàçœ]/g,
  },
  {
    label: "German",
    cues: ["und", "fur", "mit", "jetzt", "heute", "kostenlos", "versand", "kaufen", "angebot", "rabatt", "nicht", "mehr", "neu", "preis", "ihre", "sichern"],
    chars: /[äöüß]/g,
  },
  {
    label: "Italian",
    cues: ["che", "con", "ora", "oggi", "sconto", "spedizione", "gratuita", "acquista", "offerta", "piu", "nuovo", "prezzo", "della", "sulla"],
    chars: /[àèéìòù]/g,
  },
  {
    label: "Dutch",
    cues: ["het", "een", "voor", "vandaag", "korting", "verzending", "koop", "aanbieding", "alleen", "meer", "nieuw", "prijs", "jouw", "bestel", "ontdek"],
  },
  {
    label: "Turkish",
    cues: ["icin", "simdi", "bugun", "indirim", "ucretsiz", "kargo", "satin", "firsat", "sadece", "daha", "yeni", "fiyat", "hemen", "alin"],
    chars: /[şğıçöüİ]/g,
  },
  {
    label: "Polish",
    cues: ["dla", "teraz", "dzis", "znizka", "darmowa", "dostawa", "oferta", "tylko", "wiecej", "nowy", "cena", "kup", "sklep", "sprawdz"],
    chars: /[ąćęłńśźż]/g,
  },
  {
    label: "Indonesian",
    cues: ["yang", "dan", "untuk", "dengan", "sekarang", "hari", "diskon", "gratis", "ongkir", "beli", "promo", "hanya", "lebih", "baru", "harga", "belanja"],
  },
  {
    label: "Vietnamese",
    cues: ["cho", "ngay", "giam", "gia", "mien", "phi", "mua", "moi", "chi", "khuyen", "mai"],
    chars: /[đàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/g,
  },
  {
    label: "Swahili",
    cues: ["kwa", "sasa", "leo", "punguzo", "bure", "nunua", "ofa", "zaidi", "bei", "duka", "pata", "kila", "bidhaa", "haraka"],
  },
  {
    label: "Afrikaans",
    cues: ["vir", "nou", "vandag", "afslag", "koop", "aanbod", "meer", "nuwe", "prys", "jou", "ons", "baie", "gratis", "kry"],
  },
  {
    label: "Hausa",
    cues: ["yanzu", "yau", "rangwame", "kyauta", "saya", "tayin", "kawai", "sabon", "farashi", "samu", "duba"],
  },
  {
    label: "Yoruba",
    cues: ["ati", "bayi", "loni", "tuntun", "owo", "gbogbo", "ninu", "wakati", "ra"],
    chars: /[ẹọṣ]/g,
  },
] as const;


export type LatinLanguageLabel =
  | "Spanish"
  | "Portuguese"
  | "French"
  | "German"
  | "Italian"
  | "Dutch"
  | "Turkish"
  | "Polish"
  | "Indonesian"
  | "Vietnamese"
  | "Swahili"
  | "Afrikaans"
  | "Hausa"
  | "Yoruba";

export type LanguageLabel =
  | "English"
  | "Hinglish"
  | "Hindi"
  | "Regional"
  | "Global"
  | LatinLanguageLabel
  | "Unknown";

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
  const regionalSignals = INDIC_SCRIPTS.reduce((total, script) => total + (scriptSignals[script] ?? 0), 0);
  const globalSignals = GLOBAL_SCRIPTS.reduce((total, script) => total + (scriptSignals[script] ?? 0), 0);
  const totalAlpha = scriptSignals.latin + scriptSignals.devanagari + regionalSignals + globalSignals;

  if (sampleLength < 15 || totalAlpha < 8) {
    return buildResult("Unknown", 0.24, sampleLength, scriptSignals, cueMatches, "insufficient_signal");
  }

  if (regionalSignals >= 3 && regionalSignals > scriptSignals.devanagari && regionalSignals >= scriptSignals.latin / 5) {
    return buildResult("Regional", 0.88, sampleLength, scriptSignals, cueMatches, "regional_script_detected");
  }

  if (
    globalSignals >= 3 &&
    globalSignals > scriptSignals.devanagari &&
    globalSignals > regionalSignals &&
    globalSignals >= scriptSignals.latin / 5
  ) {
    return buildResult("Global", 0.88, sampleLength, scriptSignals, cueMatches, "global_script_detected");
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
    const best = bestLatinProfile(sample);
    if (best) {
      return buildResult(best.label, best.confidence, sampleLength, scriptSignals, cueMatches, "latin_language_cues");
    }
    return buildResult("English", 0.79, sampleLength, scriptSignals, cueMatches, "latin_without_hinglish_cues");
  }

  return buildResult("Unknown", 0.35, sampleLength, scriptSignals, cueMatches, "conflicting_or_weak_signal");
}

/** Minimum score gap between top two Latin-script profiles before claiming a winner. */
const LATIN_PROFILE_MARGIN = 2;

function bestLatinProfile(sample: string): { label: LatinLanguageLabel; confidence: number } | null {
  const lower = sample.toLowerCase();
  const ranked: Array<{ label: LatinLanguageLabel; score: number }> = [];

  for (const profile of LATIN_LANGUAGE_PROFILES) {
    const cueHits = profile.cues.reduce((total, word) => {
      const matches = lower.match(new RegExp(`\\b${escapeRegex(word)}\\b`, "gi"));
      return total + (matches?.length ?? 0);
    }, 0);
    const charHits = Math.min(6, profile.chars ? (sample.match(profile.chars)?.length ?? 0) : 0);
    const score = cueHits + charHits * 2;

    if (score >= 3) {
      ranked.push({ label: profile.label, score });
    }
  }

  ranked.sort((left, right) => right.score - left.score);
  const winner = ranked[0];
  if (!winner) {
    return null;
  }

  const runnerUp = ranked[1];
  if (runnerUp && winner.score - runnerUp.score < LATIN_PROFILE_MARGIN) {
    // Ambiguous Latin-script competition (e.g. Spanish vs Vietnamese cue overlap).
    // Fall through to English so Workers-AI can correct at selection time.
    return null;
  }

  return { label: winner.label, confidence: Math.min(0.93, 0.6 + winner.score * 0.04) };
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
