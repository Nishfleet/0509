import type { DiscoveryRouteContext } from "~/lib/types";

export function buildDiscoveryCacheKey(input: {
  provider: string;
  fingerprint: string;
  country: string;
  cursor?: string | null;
}) {
  return [
    input.provider.trim().toLowerCase(),
    input.fingerprint.trim(),
    input.country.trim().toLowerCase().replace(/\s+/g, "-"),
    (input.cursor ?? "page-1").trim(),
  ].join(":");
}

export function resolveDiscoveryCacheTtlMs(routeContext: DiscoveryRouteContext) {
  return routeContext === "public_search"
    ? 15 * 60 * 1000
    : 24 * 60 * 60 * 1000;
}
