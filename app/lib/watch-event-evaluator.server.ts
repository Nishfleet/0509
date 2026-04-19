import type {
  ProofCaptureRecord,
  SensitivityMode,
  WatchEventRecord,
  WatchEventStatus,
  WatchEventType,
} from "~/lib/types";

const SUPPRESSION_WINDOW_MS = 6 * 60 * 60 * 1000;

const BASE_IMPORTANCE_BY_EVENT: Record<WatchEventType, number> = {
  ad_new: 65,
  ad_inactive: 60,
  landing_page_url_changed: 85,
  landing_page_headline_changed: 75,
  landing_page_offer_changed: 74,
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
  currentProof: ComparableProofFields;
  lastSuccessfulProof: ProofCaptureRecord | null;
  recentWatchEvents: WatchEventRecord[];
  sensitivityMode: SensitivityMode;
  burstCount: number;
  now?: string;
}) : ProofEventEvaluationResult {
  if (!input.lastSuccessfulProof) {
    return {
      status: "baseline_established",
      events: [],
    };
  }

  const previous = toComparableProofFields(input.lastSuccessfulProof.extractedFields);
  const now = input.now ?? new Date().toISOString();
  const candidateDrafts = [
    buildFieldChangeDraft("landing_page_headline_changed", previous, input.currentProof),
    buildFieldChangeDraft("landing_page_offer_changed", previous, input.currentProof),
    buildFieldChangeDraft("landing_page_cta_changed", previous, input.currentProof),
    buildFieldChangeDraft("landing_page_form_changed", previous, input.currentProof),
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
        burstCount: input.burstCount,
        indiaSignals: [draft.to].some((value) => hasIndiaSignal(value)),
      }),
      title: buildEventTitle(draft.eventType),
      summary: buildEventSummary(draft.eventType),
      metadata: {
        proofTargetIdentity: input.proofTargetIdentity,
        from: draft.from,
        to: draft.to,
        diffHash: draft.diffHash,
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
  indiaSignals: boolean;
}) {
  let score = BASE_IMPORTANCE_BY_EVENT[input.eventType] ?? 50;

  if (input.proofPresent) {
    score += 5;
  }
  if (input.burstCount >= 3) {
    score += 10;
  }
  if (input.sensitivityMode === "aggressive") {
    score += 5;
  }
  if (input.sensitivityMode === "quiet") {
    score -= 10;
  }
  if (input.indiaSignals) {
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
    const previousValue = normalizeFieldValue(previous.priceText);
    const currentValue = normalizeFieldValue(current.priceText);
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
    const previousValue = normalizeFieldValue(previous.ctaText);
    const currentValue = normalizeFieldValue(current.ctaText);
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
    const sameDiff = metadata.diffHash === input.diffHash;
    const insideWindow = new Date(event.createdAt).getTime() >= cutoff;
    return (
      event.eventType === input.eventType &&
      event.status === "confirmed" &&
      sameTarget &&
      sameDiff &&
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

function hasIndiaSignal(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("₹") ||
    normalized.includes("cod") ||
    normalized.includes("emi") ||
    normalized.includes("cash on delivery")
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
