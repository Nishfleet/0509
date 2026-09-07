import type { WatchlistTrackingRole } from "~/lib/types";

export function normalizeWatchlistTrackingRole(
  value: FormDataEntryValue | string | null | undefined,
): WatchlistTrackingRole {
  return value === "self" ? "self" : "competitor";
}

export function formatWatchlistTrackingRole(role: WatchlistTrackingRole | null | undefined) {
  return role === "self" ? "My brand" : "Competitor";
}

export function formatWatchlistTargetNoun(role: WatchlistTrackingRole | null | undefined) {
  return role === "self" ? "brand" : "competitor";
}
