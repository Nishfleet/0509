import type { PresenceConnectorId, PresenceCoverageLabel } from "~/lib/presence-types";

export function formatCoverageLabel(label: PresenceCoverageLabel | PresenceConnectorId | string) {
  if (label === "website" || label === "x" || label === "reddit" || label === "linkedin") {
    return label;
  }
  return label.replaceAll("_", " — ");
}
