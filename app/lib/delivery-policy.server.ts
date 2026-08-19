import type {
  DeliveryChannel,
  DeliveryQuietHours,
  EffectiveDeliveryConfig,
  NormalizedSensitivityMode,
  WatchEventRecord,
  WatchlistDeliveryConfigRecord,
  WorkspaceDeliveryConfigRecord,
  DeliveryLane,
} from "~/lib/types";
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

function clearsInstantRule(
  lane: DeliveryLane,
  event: WatchEventRecord,
  sensitivityMode: NormalizedSensitivityMode,
) {
  const threshold = INSTANT_THRESHOLDS[sensitivityMode];

  if (lane === "customer") {
    if (event.status === "confirmed") {
      return event.importanceScore >= threshold;
    }

    if (event.status === "detected" || event.status === "proof_pending") {
      return event.importanceScore >= PROVISIONAL_CUSTOMER_THRESHOLD;
    }

    return false;
  }

  if (
    event.status === "confirmed" ||
    event.status === "proof_pending" ||
    event.status === "proof_failed"
  ) {
    return event.importanceScore >= threshold;
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
