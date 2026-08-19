import type {
  ProofCaptureRecord,
  SensitivityMode,
  WatchEventRecord,
  WatchEventStatus,
  WatchEventType,
} from "~/lib/types";
import { stripChurnTokens } from "~/lib/normalize";
// Zero-noise period triage lives in an isomorphic module (the app route
// renders it client-side); server callers keep importing this module.
export {
  WATCH_PERIOD_TRIAGE_STATUSES,
  classifyWatchPeriodTriage,
  readTriageFromDigestSummary,
  triageToDigestSummary,
  type WatchPeriodTriage,
  type WatchPeriodTriageInput,
  type WatchPeriodTriageSourceStatus,
  type WatchPeriodTriageStatus,
} from "~/lib/watch-period-triage";

// Must exceed the regular scan cadence: without a wider window, repeated
// variants of the same change (A/B tests, countdown headlines) re-alert forever.
const SUPPRESSION_WINDOW_MS = 48 * 60 * 60 * 1000;

// Instant "balanced" threshold is 75. Headline product events (new ad, offer
// change) must clear that bar or the product's core promise never fires.
const BASE_IMPORTANCE_BY_EVENT: Record<WatchEventType, number> = {
  ad_new: 76,
  ad_inactive: 60,
  landing_page_url_changed: 85,
  landing_page_headline_changed: 75,
  landing_page_offer_changed: 80,
  landing_page_cta_changed: 72,
  landing_page_form_changed: 70,
};

type ComparableProofFields = {
  rawHeadline: string | null;
  normalizedHeadline: string | null;
  normalizedHeadlineHash: string | null;
  ctaText: string | null;
  priceText: string | null;
  formPresent: boolean | null;
};

export interface EvaluatedWatchEventDraft {
  eventType: WatchEventType;
  status: Extract<WatchEventStatus, "confirmed" | "suppressed">;
  importanceScore: number;
  title: string;
  summary: string;
  metadata: Record<string, unknown>;
  dedupeReason: "proof_duplicate" | null;
}

export interface ProofEventEvaluationResult {
  status: "baseline_established" | "confirmed" | "suppressed" | "invalidated";
  events: EvaluatedWatchEventDraft[];
}

export function selectLastSuccessfulProofCapture(captures: ProofCaptureRecord[]) {
  return captures
    .filter((capture) => capture.status === "succeeded" && capture.succeededAt)
    .sort((left, right) => right.succeededAt!.localeCompare(left.succeededAt!))[0] ?? null;
}

export function evaluateProofBackedEvents(input: {
  proofTargetIdentity: string;
  currentProof: ComparableProofFields & {
    extractorVersion?: string | null;
  };
  lastSuccessfulProof: ProofCaptureRecord | null;
  recentWatchEvents: WatchEventRecord[];
  sensitivityMode: SensitivityMode;
  burstCount: number;
  currentCapturedAt?: string | null;
  now?: string;
}) : ProofEventEvaluationResult {
  const lastSuccessfulProof = input.lastSuccessfulProof;
  if (!lastSuccessfulProof) {
    return {
      status: "baseline_established",
      events: [],
    };
  }

  const previous = toComparableProofFields(lastSuccessfulProof.extractedFields);
  const comparablePrevious =
    input.currentProof.extractorVersion &&
    lastSuccessfulProof.extractorVersion !== input.currentProof.extractorVersion
      ? {
          ...previous,
          // Landing-signal parsing and form detection intentionally change
          // between extractor versions. Do not turn the one-scan rollout
          // boundary into customer-visible CTA, offer, or form events.
          ctaText: null,
          priceText: null,
          formPresent: null,
        }
      : previous;
  const now = input.now ?? new Date().toISOString();
  const candidateDrafts = [
    buildFieldChangeDraft("landing_page_headline_changed", comparablePrevious, input.currentProof),
    buildFieldChangeDraft("landing_page_offer_changed", comparablePrevious, input.currentProof),
    buildFieldChangeDraft("landing_page_cta_changed", comparablePrevious, input.currentProof),
    buildFieldChangeDraft("landing_page_form_changed", comparablePrevious, input.currentProof),
  ].filter((draft): draft is NonNullable<typeof draft> => Boolean(draft));

  if (candidateDrafts.length === 0) {
    return {
      status: "invalidated",
      events: [],
    };
  }

  const events = candidateDrafts.map((draft) => {
    const duplicate = hasDuplicateWithinWindow({
      eventType: draft.eventType,
      diffHash: draft.diffHash,
      proofTargetIdentity: input.proofTargetIdentity,
      recentWatchEvents: input.recentWatchEvents,
      now,
    });
    const status: Extract<WatchEventStatus, "confirmed" | "suppressed"> = duplicate
      ? "suppressed"
      : "confirmed";

    return {
      eventType: draft.eventType,
      status,
      importanceScore: scoreWatchEventImportance({
        eventType: draft.eventType,
        proofPresent: true,
        sensitivityMode: input.sensitivityMode,
        // Burst means "several things changed at once on this page", not
        // "the watchlist observes many ads" — the latter permanently
        // inflated every event on any busy watchlist.
        burstCount: candidateDrafts.length,
        purchaseSignals: [draft.to].some((value) => hasPurchaseSignal(value)),
      }),
      title: buildEventTitle(draft.eventType),
      summary: buildEventSummary(draft.eventType),
      metadata: {
        proofTargetIdentity: input.proofTargetIdentity,
        from: draft.from,
        to: draft.to,
        diffHash: draft.diffHash,
        ...(lastSuccessfulProof.succeededAt && input.currentCapturedAt
          ? {
              beforeCapturedAt: lastSuccessfulProof.succeededAt,
              capturedAt: input.currentCapturedAt,
            }
          : {}),
      },
      dedupeReason: duplicate ? "proof_duplicate" : null,
    } satisfies EvaluatedWatchEventDraft;
  });

  return {
    status: events.every((event) => event.status === "suppressed") ? "suppressed" : "confirmed",
    events,
  };
}

export function scoreWatchEventImportance(input: {
  eventType: WatchEventType;
  proofPresent: boolean;
  sensitivityMode: SensitivityMode;
  burstCount: number;
  /** Purchase/currency pressure signals (any market — not India-only). */
  purchaseSignals: boolean;
}) {
  let score = BASE_IMPORTANCE_BY_EVENT[input.eventType] ?? 50;

  // No proof-presence bump: every proof-backed event having +5 pushed all
  // four landing-page change types over the balanced instant threshold (75),
  // making "balanced" behave like "aggressive" for exactly the noisiest
  // event family. Proof is the norm, not a signal of importance.
  if (input.burstCount >= 3) {
    score += 10;
  }
  if (input.sensitivityMode === "aggressive") {
    score += 5;
  }
  if (input.sensitivityMode === "quiet") {
    score -= 10;
  }
  if (input.purchaseSignals) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

function buildFieldChangeDraft(
  eventType:
    | "landing_page_headline_changed"
    | "landing_page_offer_changed"
    | "landing_page_cta_changed"
    | "landing_page_form_changed",
  previous: ComparableProofFields,
  current: ComparableProofFields,
) {
  if (eventType === "landing_page_headline_changed") {
    if (
      previous.normalizedHeadlineHash &&
      current.normalizedHeadlineHash &&
      previous.normalizedHeadlineHash !== current.normalizedHeadlineHash
    ) {
      return {
        eventType,
        from: previous.rawHeadline ?? previous.normalizedHeadline ?? "",
        to: current.rawHeadline ?? current.normalizedHeadline ?? "",
        diffHash: `${eventType}:${previous.normalizedHeadlineHash}:${current.normalizedHeadlineHash}`,
      };
    }

    return null;
  }

  if (eventType === "landing_page_offer_changed") {
    // Churn-stable comparison: countdown timers, rolling dates, and live
    // inventory counters in the price/offer line (e.g. "Only 3 left · ₹499")
    // must not fire an offer event on every scan. The raw values are still
    // stored for display and evidence. Lowercase before stripping so the
    // churn patterns (which are lowercase) also match uppercase urgency copy
    // like "ONLY 3 LEFT · ₹499" — the headline path already lowercases first.
    const previousValue = normalizeFieldValue(stripChurnTokens(previous.priceText?.toLowerCase()));
    const currentValue = normalizeFieldValue(stripChurnTokens(current.priceText?.toLowerCase()));
    if (previousValue && currentValue && previousValue !== currentValue) {
      return {
        eventType,
        from: previous.priceText ?? "",
        to: current.priceText ?? "",
        diffHash: `${eventType}:${previousValue}:${currentValue}`,
      };
    }

    return null;
  }

  if (eventType === "landing_page_cta_changed") {
    // Churn-stable comparison: a "Claim offer · 00:59:59" CTA ticking between
    // scans is the same CTA. The raw values are still stored for display and
    // evidence. Lowercase before stripping so uppercase urgency copy (e.g.
    // "HURRY · 00:59:59") is also treated as churn, matching the headline path.
    const previousValue = normalizeFieldValue(stripChurnTokens(previous.ctaText?.toLowerCase()));
    const currentValue = normalizeFieldValue(stripChurnTokens(current.ctaText?.toLowerCase()));
    if (previousValue && currentValue && previousValue !== currentValue) {
      return {
        eventType,
        from: previous.ctaText ?? "",
        to: current.ctaText ?? "",
        diffHash: `${eventType}:${previousValue}:${currentValue}`,
      };
    }

    return null;
  }

  if (previous.formPresent !== null && current.formPresent !== null && previous.formPresent !== current.formPresent) {
    return {
      eventType,
      from: previous.formPresent ? "form_present" : "form_absent",
      to: current.formPresent ? "form_present" : "form_absent",
      diffHash: `${eventType}:${previous.formPresent}:${current.formPresent}`,
    };
  }

  return null;
}

function hasDuplicateWithinWindow(input: {
  eventType: WatchEventType;
  diffHash: string;
  proofTargetIdentity: string;
  recentWatchEvents: WatchEventRecord[];
  now: string;
}) {
  const cutoff = new Date(input.now).getTime() - SUPPRESSION_WINDOW_MS;

  return input.recentWatchEvents.some((event) => {
    const metadata = event.metadata ?? {};
    const sameTarget = metadata.proofTargetIdentity === input.proofTargetIdentity;
    const insideWindow = new Date(event.createdAt).getTime() >= cutoff;
    // Per-FIELD suppression, deliberately ignoring the from→to diff hash:
    // an A/B page alternating A→B then B→A produces two distinct hashes and
    // would never dedupe, emailing the customer daily about the same test.
    // One alert per field per window is the contract.
    return (
      event.eventType === input.eventType &&
      event.status === "confirmed" &&
      sameTarget &&
      insideWindow
    );
  });
}

function toComparableProofFields(fields: Record<string, unknown>): ComparableProofFields {
  return {
    rawHeadline: stringOrNull(fields.rawHeadline),
    normalizedHeadline: stringOrNull(fields.normalizedHeadline),
    normalizedHeadlineHash: stringOrNull(fields.normalizedHeadlineHash),
    ctaText: stringOrNull(fields.ctaText),
    priceText: stringOrNull(fields.priceText),
    formPresent: typeof fields.formPresent === "boolean" ? fields.formPresent : null,
  };
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeFieldValue(value: string | null) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? null;
}

/**
 * Global-first purchase pressure cues: major currency markers plus common
 * checkout incentives. Not market-specific (₹ and € score the same).
 */
export function hasPurchaseSignal(value: string) {
  const normalized = value.toLowerCase();
  // FIX-7: do not put multi-char `zł` inside a character class (bare `z` match).
  if (
    /[₹$€£¥₺]|zł/.test(value) ||
    /\b(?:usd|eur|gbp|inr|jpy|cad|aud|sgd|aed|sar)\b/.test(normalized)
  ) {
    return true;
  }
  return (
    normalized.includes("cod") ||
    normalized.includes("emi") ||
    normalized.includes("cash on delivery") ||
    normalized.includes("free shipping") ||
    normalized.includes("free delivery") ||
    normalized.includes("% off") ||
    normalized.includes("percent off") ||
    /\bbogo\b/.test(normalized) ||
    /\bbuy\s+\d+\s+get\b/.test(normalized)
  );
}

function buildEventTitle(eventType: WatchEventType) {
  switch (eventType) {
    case "landing_page_headline_changed":
      return "Landing page headline changed";
    case "landing_page_offer_changed":
      return "Landing page offer changed";
    case "landing_page_cta_changed":
      return "Landing page CTA changed";
    case "landing_page_form_changed":
      return "Landing page form changed";
    default:
      return "Landing page changed";
  }
}

function buildEventSummary(eventType: WatchEventType) {
  switch (eventType) {
    case "landing_page_headline_changed":
      return "The landing-page headline changed.";
    case "landing_page_offer_changed":
      return "The landing-page offer or price changed.";
    case "landing_page_cta_changed":
      return "The landing-page call to action changed.";
    case "landing_page_form_changed":
      return "The landing-page form state changed.";
    default:
      return "The landing page changed.";
  }
}
