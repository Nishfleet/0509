import type {
  PresenceConnectorId,
  PresenceCoverageLabel,
  PresenceSourceCoverageStatus,
  PresenceTrackingMode,
} from "~/lib/presence-types";

const COVERAGE_LABEL_COPY: Record<PresenceCoverageLabel, string> = {
  CONNECTED_ACCOUNT: "Connected account",
  OFFICIAL_PUBLIC_API: "Official public API",
  VERIFIED_PUBLIC_FEED: "Verified public feed",
  PUBLIC_WEB_BEST_EFFORT: "Public web — best effort",
  LIMITED_COVERAGE: "Limited coverage",
  UNAVAILABLE: "Unavailable",
};

const CONNECTOR_COPY: Record<PresenceConnectorId, string> = {
  website: "Website",
  x: "X",
  reddit: "Reddit",
  linkedin: "LinkedIn",
  rss: "RSS / Atom / JSON Feed",
};

const SOURCE_COVERAGE_STATUS_COPY: Record<PresenceSourceCoverageStatus, string> = {
  active: "Active",
  available: "Available",
  connected: "Connected",
  gated: "Gated",
  planned: "Planned",
  manual_only: "Manual proof only",
  limited: "Limited",
  unavailable: "Unavailable",
  degraded: "Degraded",
};

const TRACKING_MODE_COPY: Record<PresenceTrackingMode, string> = {
  self: "Your brand",
  competitor: "Competitor",
};

export function formatCoverageLabel(label: PresenceCoverageLabel | PresenceConnectorId | string) {
  if (label in CONNECTOR_COPY) {
    return CONNECTOR_COPY[label as PresenceConnectorId];
  }
  if (label in COVERAGE_LABEL_COPY) {
    return COVERAGE_LABEL_COPY[label as PresenceCoverageLabel];
  }
  return label.replaceAll("_", " — ");
}

export function formatSourceCoverageStatus(status: PresenceSourceCoverageStatus | string) {
  if (status in SOURCE_COVERAGE_STATUS_COPY) {
    return SOURCE_COVERAGE_STATUS_COPY[status as PresenceSourceCoverageStatus];
  }
  return status.replaceAll("_", " ");
}

export function formatTrackingMode(mode: PresenceTrackingMode | string) {
  if (mode in TRACKING_MODE_COPY) {
    return TRACKING_MODE_COPY[mode as PresenceTrackingMode];
  }
  return mode;
}

export function formatRolloutState(state: string) {
  switch (state) {
    case "disabled":
      return "Disabled";
    case "internal":
      return "Internal canary";
    case "pilot":
      return "Controlled pilot";
    case "ga":
      return "Generally available";
    default:
      return state;
  }
}
