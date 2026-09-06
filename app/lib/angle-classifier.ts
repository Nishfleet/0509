/**
 * Marketing-angle classification for ad copy.
 *
 * Shared module (client + server), modeled on the cue-profile architecture in
 * `language-classifier.ts`: each angle has a profile of literal cues and regex
 * patterns; the winner must clear a minimum score AND a margin over the
 * runner-up, otherwise we return null. Honest by design — no guessing.
 */

export type AngleId =
  | "discount_urgency"
  | "social_proof"
  | "problem_solution"
  | "new_launch"
  | "ugc_style"
  | "brand_lifestyle";

export interface AngleClassification {
  angle: AngleId;
  /** Cue words/phrases (or matched pattern text) that drove the decision. */
  matchedCues: string[];
  /**
   * Explicit lower-confidence marker. Always true for `brand_lifestyle`,
   * which is a fallback read (absence of other cues), never a cue match.
   */
  lowConfidence: boolean;
}

/** Text shorter than this carries too little signal to classify. */
const MIN_TEXT_LENGTH = 20;
/** A profile must reach this score before it can win. */
const MIN_ANGLE_SCORE = 2;
/** Minimum score gap between winner and runner-up (mirrors LATIN_PROFILE_MARGIN). */
const ANGLE_MARGIN = 2;
/** Below this length, text is not substantive enough for the brand_lifestyle fallback. */
const MIN_LIFESTYLE_TEXT_LENGTH = 60;
/** Stray-cue tolerance for the brand_lifestyle fallback (see classifyAdAngle). */
const MAX_LIFESTYLE_STRAY_SCORE = 1;
/** Points per matched literal cue / per matched regex pattern. */
const LITERAL_CUE_SCORE = 1;
const PATTERN_CUE_SCORE = 2;

interface AngleProfile {
  id: Exclude<AngleId, "brand_lifestyle">;
  /** Word-boundary-safe, case-insensitive literal cues (words or phrases). */
  cues: readonly string[];
  /** Regex cues for shapes literals cannot express ("30% off", "12,000 reviews"). */
  patterns?: readonly RegExp[];
}

const ANGLE_PROFILES: readonly AngleProfile[] = [
  {
    id: "discount_urgency",
    cues: [
      // English
      "sale", "flash sale", "clearance", "deal", "deals", "discount", "coupon",
      "promo code", "use code", "free shipping", "free delivery", "ends soon",
      "ends today", "ends tonight", "last chance", "limited time", "today only",
      "hurry", "while stocks last", "while supplies last", "price drop",
      "lowest price", "save big", "don't miss out",
      // Spanish
      "descuento", "oferta", "ofertas", "rebajas", "envio gratis", "envío gratis",
      "cupon", "cupón", "solo hoy", "ultima oportunidad", "última oportunidad",
      // Portuguese
      "desconto", "promocao", "promoção", "frete gratis", "frete grátis",
      "cupom", "so hoje", "só hoje",
      // French
      "soldes", "promo", "remise", "reduction", "réduction",
      "livraison gratuite", "vente flash", "derniere chance", "dernière chance",
      // German
      "rabatt", "angebot", "gutschein", "kostenloser versand", "nur heute",
      "letzte chance", "jetzt sparen",
    ],
    patterns: [
      /\b\d{1,3}\s?%\s?off\b/i,
      /\bup to \d{1,3}\s?%/i,
      /-\s?\d{1,3}\s?%/,
      /\b\d{1,3}\s?%\s?(?:de\s)?(?:descuento|desconto|reduction|réduction|rabatt)\b/i,
      /\bcode\s+[a-z0-9]{3,}\b/i,
    ],
  },
  {
    id: "social_proof",
    cues: [
      "reviews", "rated", "top rated", "top-rated", "loved by", "bestseller",
      "best seller", "best-seller", "viral", "award", "award-winning",
      "trusted by", "as seen on", "everyone's talking", "everyone is talking",
      "5-star", "five-star", "recommended by", "join thousands",
      "customers love", "testimonials", "featured in",
      // es / pt / fr / de
      "opiniones", "avaliacoes", "avaliações", "avis", "bewertungen",
      "meistverkauft",
    ],
    patterns: [
      /\b\d[\d,.]*\s?(?:\+\s?)?(?:happy )?(?:customers|clients|reviews|users|members|clientes|opiniones|avis|kunden|bewertungen)\b/i,
      /\b[4-5](?:[.,]\d)?\s?(?:stars?|étoiles|sterne|estrellas|\/5)\b/i,
      /★{3,}/,
    ],
  },
  {
    id: "problem_solution",
    cues: [
      "tired of", "struggling", "fix", "fixes", "solve", "solves", "solved",
      "say goodbye to", "no more", "sick of", "fed up", "frustrated",
      "the solution", "without the hassle", "pain", "problem",
      // es / pt / fr / de
      "basta de", "adios a", "adiós a", "chega de", "marre de", "dites adieu",
      "schluss mit",
    ],
    patterns: [/\bstop\s+\w+ing\b/i],
  },
  {
    id: "new_launch",
    cues: [
      "new", "introducing", "just dropped", "just launched", "limited edition",
      "meet the", "now available", "brand new", "all-new", "all new", "newest",
      "new arrival", "new arrivals", "new collection", "launch", "launching",
      "finally here", "say hello to",
      // Spanish
      "nuevo", "nueva", "nuevos", "nuevas", "lanzamiento", "ya disponible",
      // Portuguese
      "novo", "nova", "lancamento", "lançamento", "ja disponivel", "já disponível",
      // French
      "nouveau", "nouvelle", "nouveaute", "nouveauté", "lancement",
      "enfin disponible", "maintenant disponible",
      // German
      "neu", "neue", "neues", "neuheit", "brandneu", "endlich da",
      "jetzt erhaltlich", "jetzt erhältlich",
    ],
  },
  {
    id: "ugc_style",
    cues: [
      "i tried", "my honest", "honest review", "obsessed with", "i'm obsessed",
      "im obsessed", "i can't believe", "i cant believe", "i was skeptical",
      "i bought", "i've been using", "ive been using", "i finally found",
      "my go-to", "here's why i", "not sponsored", "i'm not gonna lie", "ngl",
      "pov", "10/10",
    ],
  },
] as const;

/**
 * Offer/CTA pressure signals that disqualify the brand_lifestyle fallback:
 * evocative brand copy must be free of price and hard-sell push.
 */
const PRESSURE_PATTERNS: readonly RegExp[] = [
  /\b(?:buy|shop|order) (?:now|today)\b/i,
  /\badd to cart\b/i,
  /\b(?:sale|deals?|discount|free shipping|limited time|use code)\b/i,
  /[$€£₹]\s?\d/,
  /\d\s?%/,
];

const EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;
const FIRST_PERSON_PATTERN = /\b(?:i|i'm|i've|my|me)\b/i;
/** Emoji-dense first-person copy is a UGC signal even without phrase cues. */
const UGC_EMOJI_THRESHOLD = 3;
const UGC_EMOJI_CUE = "emoji-dense first-person";

interface AngleScore {
  id: Exclude<AngleId, "brand_lifestyle">;
  score: number;
  matchedCues: string[];
}

/**
 * Classify concatenated ad text (hook + body + offer + cta) into a single
 * dominant marketing angle. Returns null when the text is too short, no
 * profile clears the minimum threshold, or the top two profiles are too
 * close to call — never guesses.
 */
export function classifyAdAngle(text: string): AngleClassification | null {
  const sample = normalizeSample(text);
  if (sample.length < MIN_TEXT_LENGTH) {
    return null;
  }

  const scores = ANGLE_PROFILES.map((profile) => scoreProfile(profile, sample));
  const ranked = [...scores].sort((left, right) => right.score - left.score);
  const winner = ranked[0];
  const runnerUp = ranked[1];

  if (winner && winner.score >= MIN_ANGLE_SCORE) {
    if (runnerUp && winner.score - runnerUp.score < ANGLE_MARGIN) {
      return null; // Too close to call — ambiguous mix of angles.
    }
    return { angle: winner.id, matchedCues: winner.matchedCues, lowConfidence: false };
  }

  if (isBrandLifestyle(sample, ranked[0]?.score ?? 0)) {
    return { angle: "brand_lifestyle", matchedCues: [], lowConfidence: true };
  }

  return null;
}

function normalizeSample(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function scoreProfile(profile: AngleProfile, sample: string): AngleScore {
  const matchedCues: string[] = [];
  let score = 0;

  for (const cue of profile.cues) {
    if (new RegExp(`\\b${escapeRegex(cue)}\\b`, "i").test(sample)) {
      matchedCues.push(cue);
      score += LITERAL_CUE_SCORE;
    }
  }

  for (const pattern of profile.patterns ?? []) {
    const match = sample.match(pattern);
    if (match) {
      matchedCues.push(match[0].trim());
      score += PATTERN_CUE_SCORE;
    }
  }

  if (profile.id === "ugc_style" && hasEmojiDenseFirstPerson(sample)) {
    matchedCues.push(UGC_EMOJI_CUE);
    score += PATTERN_CUE_SCORE;
  }

  return { id: profile.id, score, matchedCues };
}

function hasEmojiDenseFirstPerson(sample: string): boolean {
  const emojiCount = sample.match(EMOJI_PATTERN)?.length ?? 0;
  return emojiCount >= UGC_EMOJI_THRESHOLD && FIRST_PERSON_PATTERN.test(sample);
}

/**
 * brand_lifestyle is a fallback read, not a cue match: substantive copy with
 * (at most a stray) commercial cue and zero offer/CTA pressure. Anything with
 * pressure signals but no clear angle stays null — we do not guess.
 */
function isBrandLifestyle(sample: string, topScore: number): boolean {
  if (sample.length < MIN_LIFESTYLE_TEXT_LENGTH) return false;
  if (topScore > MAX_LIFESTYLE_STRAY_SCORE) return false;
  return !PRESSURE_PATTERNS.some((pattern) => pattern.test(sample));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
