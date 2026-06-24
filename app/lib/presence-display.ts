import type { PresenceConnectorId, PresenceCoverageLabel } from "~/lib/presence-types";

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
