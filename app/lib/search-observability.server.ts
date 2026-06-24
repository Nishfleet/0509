import { hashString } from "~/lib/normalize";
import type { SearchV2Result } from "~/lib/search-v2.server";

export interface SearchObservabilityEvent {
  kind: "search_v2";
  intent: "domain" | "text";
  scope: "exact" | "broader";
  domainHash: string | null;
  registrableDomain: string | null;
  verifiedCount: number;
  broaderCandidateCount: number;
  rejectedKeywordOnlyCount: number;
  provider: string | null;
  cacheStatus: string | null;
  durationMs: number | null;
  identityResolved: boolean;
  errorCategory: string | null;
}

export function recordSearchObservabilityEvent(event: SearchObservabilityEvent) {
  console.info(
    JSON.stringify({
      ...event,
      ts: new Date().toISOString(),
    }),
  );
}

export function buildSearchObservabilityEvent(input: {
  result: SearchV2Result;
  durationMs?: number | null;
  identityResolved?: boolean;
  errorCategory?: string | null;
}): SearchObservabilityEvent {
  const domain = input.result.displayDomain;

  return {
    kind: "search_v2",
    intent: input.result.searchIntent,
    scope: input.result.searchScope,
    domainHash: domain ? hashString(domain) : null,
    registrableDomain: domain,
    verifiedCount: input.result.verifiedCount,
    broaderCandidateCount: input.result.broaderCandidateCount,
    rejectedKeywordOnlyCount: input.result.rejectedKeywordOnlyCount,
    provider: input.result.provider ?? input.result.source ?? null,
    cacheStatus: input.result.cacheStatus ?? null,
    durationMs: input.durationMs ?? null,
    identityResolved: input.identityResolved ?? false,
    errorCategory: input.errorCategory ?? null,
  };
}
