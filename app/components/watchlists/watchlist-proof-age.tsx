import { formatProofAgeLabel } from "~/lib/landing-page-display";

export function WatchlistProofAge({ capturedAt, renderedAt }: { capturedAt: string; renderedAt: string }) {
  return formatProofAgeLabel(capturedAt, { now: renderedAt });
}
