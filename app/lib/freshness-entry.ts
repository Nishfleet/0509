export interface FreshnessEntry {
  key: string;
  name: string;
  state: "live" | "none" | "degraded";
  lastLandedAt: string | null;
  reason: string | null;
}
