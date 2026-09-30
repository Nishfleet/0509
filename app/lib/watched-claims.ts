import { sourcePillStatus, type SourceRow, type SourceSnapshot } from "../components/source-pill";
import { joinList, LIVE_COVERAGE } from "./coverage";

export interface ClaimSource {
  source: SourceRow;
  snapshot: SourceSnapshot | null;
}

export interface WatchedClaims {
  nouns: string;
  features: readonly string[];
}

export const UNANSWERED_NOUNS = "public sources";

export function watchedClaims(sources: readonly ClaimSource[], now: number): WatchedClaims {
  const answering = new Set(
    sources.flatMap((entry) => {
      const state = sourcePillStatus(entry.source, entry.snapshot, now).state;
      return state === "live" || state === "none" ? [entry.source.key] : [];
    }),
  );
  const groups = LIVE_COVERAGE.map((group) => ({
    ...group,
    sources: group.sources.filter((source) => source.sourceKey === undefined || answering.has(source.sourceKey)),
  })).filter((group) => group.sources.length > 0);
  const nouns = joinList(groups.flatMap((group) => group.noun ?? []));
  return {
    nouns: nouns === "" ? UNANSWERED_NOUNS : nouns,
    features: groups.flatMap((group) => group.sources.map((source) => `${group.kind}: ${source.label}`)),
  };
}
