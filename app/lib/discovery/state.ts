export type DiscoveryState = "looking" | "done" | "unavailable";

const LOOKING = new Set(["queued", "running", "waiting", "waitingForPause"]);

export function discoveryStateFor(status: string): DiscoveryState {
  if (LOOKING.has(status)) return "looking";
  return status === "complete" ? "done" : "unavailable";
}

export function discoveryNotice(state: DiscoveryState, competitorCount: number): string | null {
  if (state === "looking") {
    return "We're reading the news for brands named alongside you. They appear here as we find them.";
  }
  if (competitorCount > 0) return null;
  if (state === "done") {
    return "We looked and found no obvious rivals yet. Add any you know below, or tap Start watching and we'll keep looking every night.";
  }
  return "We couldn't look for rivals just now. Add any you know below, or tap Start watching and we'll try again tonight.";
}
