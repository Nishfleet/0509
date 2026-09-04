import type {
  DeliveryChannel,
  DeliveryLane,
  DeliveryQuietHours,
  EffectiveDeliveryConfig,
  NormalizedSensitivityMode,
  WatchEventRecord,
  WatchEventType,
  WatchlistDeliveryConfigRecord,
  WorkspaceDeliveryConfigRecord,
} from "~/lib/types";
import {
  isLandingPageHeadlineEventType,
  landingPageTypeWeight,
  whyThisMattersScoreForRecord,
} from "~/lib/digest-rerank";
import { safeTimeZone } from "~/lib/safe-timezone";

const INSTANT_THRESHOLDS: Record<NormalizedSensitivityMode, number> = {
  quiet: 90,
  balanced: 75,
  aggressive: 65,
};

const PROVISIONAL_CUSTOMER_THRESHOLD = 95;
export const CUSTOMER_DIGEST_PROVISIONAL_IMPORTANCE_THRESHOLD = 85;
const BATCH_WINDOW_MS = 15 * 60 * 1000;

export interface DeliveryPolicyDecision {
  effectiveConfig: EffectiveDeliveryConfig;
  allowedChannels: DeliveryChannel[];
  instantEligible: boolean;
  digestEligible: boolean;
  provisional: boolean;
  deferredByQuietHours: boolean;
  batchKey: string;
  skipReason: string | null;
}

export function normalizeSensitivityMode(
  sensitivityMode: WorkspaceDeliveryConfigRecord["sensitivityMode"],
): NormalizedSensitivityMode {
  return sensitivityMode === "auto" ? "balanced" : sensitivityMode;
}

export function resolveDeliveryConfig(input: {
  workspaceConfig: WorkspaceDeliveryConfigRecord;
  watchlistConfig: WatchlistDeliveryConfigRecord | null;
}): EffectiveDeliveryConfig {
  const source = input.watchlistConfig ?? input.workspaceConfig;

  return {
    sensitivityMode: normalizeSensitivityMode(source.sensitivityMode),
    instantEnabled: source.instantEnabled,
    digestEnabled: source.digestEnabled,
    emailEnabled: source.emailEnabled,
    whatsappEnabled: source.whatsappEnabled,
    slackEnabled: source.slackEnabled,
    teamsEnabled: source.teamsEnabled,
    quietHours: source.quietHours,
    timezone: source.timezone,
  };
}

export function evaluateDeliveryPolicy(input: {
  lane: DeliveryLane;
  event: WatchEventRecord;
  workspaceConfig: WorkspaceDeliveryConfigRecord;
  watchlistConfig: WatchlistDeliveryConfigRecord | null;
  now?: string;
}): DeliveryPolicyDecision {
  const effectiveConfig = resolveDeliveryConfig({
    workspaceConfig: input.workspaceConfig,
    watchlistConfig: input.watchlistConfig,
  });
  const allowedChannels = resolveAllowedChannels(effectiveConfig);
  const batchKey = buildDeliveryBatchKey({
    watchlistId: input.event.watchlistId,
    competitorLabel: readCompetitorLabel(input.event),
    eventCreatedAt: input.event.createdAt,
  });

  if (allowedChannels.length === 0) {
    return {
      effectiveConfig,
      allowedChannels,
      instantEligible: false,
      digestEligible: false,
      provisional: false,
      deferredByQuietHours: false,
      batchKey,
      skipReason: "no_enabled_channels",
    };
  }

  const provisional = isProvisionalCustomerSend(input.lane, input.event);
  const instantEligible =
    effectiveConfig.instantEnabled &&
    clearsInstantRule(input.lane, input.event, effectiveConfig.sensitivityMode);
  const digestEligible =
    effectiveConfig.digestEnabled &&
    clearsDigestRule(input.lane, input.event);
  const inQuietHours = isInsideQuietHours(
    effectiveConfig.quietHours,
    effectiveConfig.timezone,
    input.now,
  );

  if (input.lane === "customer" && isBlockedCustomerStatus(input.event.status)) {
    return {
      effectiveConfig,
      allowedChannels,
      instantEligible: false,
      digestEligible: false,
      provisional: false,
      deferredByQuietHours: false,
      batchKey,
      skipReason: "customer_requires_trusted_status",
    };
  }

  if (instantEligible && inQuietHours) {
    return {
      effectiveConfig,
      allowedChannels,
      instantEligible: false,
      digestEligible,
      provisional,
      deferredByQuietHours: true,
      batchKey,
      skipReason: null,
    };
  }

  return {
    effectiveConfig,
    allowedChannels,
    instantEligible,
    digestEligible,
    provisional,
    deferredByQuietHours: false,
    batchKey,
    skipReason: instantEligible || digestEligible ? null : "below_delivery_threshold",
  };
}

export function buildDeliveryBatchKey(input: {
  watchlistId: string;
  competitorLabel: string | null;
  eventCreatedAt: string;
}) {
  const bucket = Math.floor(new Date(input.eventCreatedAt).getTime() / BATCH_WINDOW_MS);
  return [
    sanitizeBatchSegment(input.watchlistId),
    sanitizeBatchSegment(input.competitorLabel ?? "unknown"),
    String(bucket),
  ].join(":");
}

function resolveAllowedChannels(config: EffectiveDeliveryConfig): DeliveryChannel[] {
  const channels: DeliveryChannel[] = [];

  if (config.emailEnabled) {
    channels.push("email");
  }
  if (config.whatsappEnabled) {
    channels.push("whatsapp");
  }
  if (config.slackEnabled) {
    channels.push("slack");
  }
  if (config.teamsEnabled) {
    channels.push("teams");
  }

  return channels;
}

/**
 * Full why-this-matters threshold for one mode: the event type's weight plus
 * the mode's importance gate. Because landing-page type weights (500-1000)
 * dwarf the 0-100 gates, `score >= threshold` on the full score is exactly
 * `importanceScore >= gate` for landing_page_* events — the gate keeps its
 * established magnitudes while the comparison uses the same weighted score
 * that orders the brief. Non-landing event types return Infinity: whatever
 * their score, they are never instant-eligible.
 */
function whyThisMattersInstantThreshold(
  eventType: WatchEventType,
  sensitivityMode: NormalizedSensitivityMode,
  overrideGate?: number,
) {
  if (!isLandingPageHeadlineEventType(eventType)) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    landingPageTypeWeight(eventType) +
    (overrideGate ?? INSTANT_THRESHOLDS[sensitivityMode])
  );
}

function clearsInstantRule(
  lane: DeliveryLane,
  event: WatchEventRecord,
  sensitivityMode: NormalizedSensitivityMode,
) {
  // BET 1 (issue 1483): instant alerts are a landing-page privilege only. A
  // bare ad_new / ad_inactive ping can never interrupt the customer — it only
  // ever reaches the counted digest footnote, whatever its score or the
  // sensitivity mode — and website_page_* events are not an instant-alert
  // class either. The why-this-matters score gates magnitude: below the
  // per-mode threshold even a landing change stays quiet.
  const score = whyThisMattersScoreForRecord(event);
  const threshold = whyThisMattersInstantThreshold(
    event.eventType,
    sensitivityMode,
  );

  if (lane === "customer") {
    if (event.status === "confirmed") {
      return score >= threshold;
    }

    if (event.status === "detected" || event.status === "proof_pending") {
      return (
        score >=
        whyThisMattersInstantThreshold(
          event.eventType,
          sensitivityMode,
          PROVISIONAL_CUSTOMER_THRESHOLD,
        )
      );
    }

    return false;
  }

  if (
    event.status === "confirmed" ||
    event.status === "proof_pending" ||
    event.status === "proof_failed"
  ) {
    return score >= threshold;
  }

  return false;
}

function clearsDigestRule(lane: DeliveryLane, event: WatchEventRecord) {
  if (lane === "customer") {
    return isCustomerDigestEligibleEvent(event);
  }

  return (
    event.status === "confirmed" ||
    event.status === "proof_pending" ||
    event.status === "proof_failed"
  );
}

export function isCustomerDigestEligibleEvent(
  event: Pick<WatchEventRecord, "status" | "importanceScore">,
) {
  if (event.status === "confirmed") {
    return true;
  }

  if (event.status === "detected" || event.status === "proof_pending") {
    return event.importanceScore >= CUSTOMER_DIGEST_PROVISIONAL_IMPORTANCE_THRESHOLD;
  }

  return false;
}

function isBlockedCustomerStatus(status: WatchEventRecord["status"]) {
  return status === "proof_failed" || status === "suppressed" || status === "invalidated";
}

function isProvisionalCustomerSend(lane: DeliveryLane, event: WatchEventRecord) {
  return lane === "customer" && (event.status === "detected" || event.status === "proof_pending");
}

function isInsideQuietHours(
  quietHours: DeliveryQuietHours | null,
  timezone: string | null,
  now = new Date().toISOString(),
) {
  if (!quietHours) {
    return false;
  }

  const hour = getLocalHour(now, timezone);
  if (quietHours.startHour === quietHours.endHour) {
    return false;
  }

  if (quietHours.startHour < quietHours.endHour) {
    return hour >= quietHours.startHour && hour < quietHours.endHour;
  }

  return hour >= quietHours.startHour || hour < quietHours.endHour;
}

function getLocalHour(timestamp: string, timezone: string | null) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: safeTimeZone(timezone),
  });
  return Number.parseInt(formatter.format(new Date(timestamp)), 10);
}

function readCompetitorLabel(event: WatchEventRecord) {
  const advertiser = event.metadata.advertiser;
  if (typeof advertiser === "string" && advertiser.trim().length > 0) {
    return advertiser;
  }

  return null;
}

function sanitizeBatchSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
