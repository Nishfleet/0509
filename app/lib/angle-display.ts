import type { AngleClassification, AngleId } from "~/lib/angle-classifier";

export interface AngleDisplay {
  label: string;
  explanation: string;
}

/** Customer-facing label + one-line explanation per marketing angle. */
export const ANGLE_DISPLAY: Record<AngleId, AngleDisplay> = {
  discount_urgency: {
    label: "Discount & urgency",
    explanation: "Price-led with time pressure",
  },
  social_proof: {
    label: "Social proof",
    explanation: "Leans on reviews, ratings, and popularity",
  },
  problem_solution: {
    label: "Problem → solution",
    explanation: "Names a pain and positions the product as the fix",
  },
  new_launch: {
    label: "New launch",
    explanation: "Announces something new or just released",
  },
  ugc_style: {
    label: "UGC style",
    explanation: "First-person testimonial voice, creator-ad feel",
  },
  brand_lifestyle: {
    label: "Brand & lifestyle",
    explanation: "Evocative brand copy without offer or CTA pressure",
  },
};

/** Cap the detail-panel cue list so it stays a one-liner. */
const MAX_DETAIL_CUES = 3;

/** Tooltip copy: "Discount & urgency — Price-led with time pressure". */
export function formatAngleTooltip(classification: AngleClassification): string {
  const display = ANGLE_DISPLAY[classification.angle];
  return `${display.label} — ${display.explanation}`;
}

/**
 * Detail-panel copy: "Social proof — 'bestseller', '5,000 reviews'".
 * Falls back to the explanation when there are no matched cues
 * (brand_lifestyle is a fallback read, not a cue match).
 */
export function formatAngleDetail(classification: AngleClassification): string {
  const display = ANGLE_DISPLAY[classification.angle];
  if (classification.matchedCues.length === 0) {
    return `${display.label} — ${display.explanation.toLowerCase()}`;
  }
  const cues = classification.matchedCues
    .slice(0, MAX_DETAIL_CUES)
    .map((cue) => `‘${cue}’`)
    .join(", ");
  return `${display.label} — ${cues}`;
}
