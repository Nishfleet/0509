import { nextHour } from "./home-standing";

export function nextOwnSiteCheck(now: Date): string {
  return nextHour(now).toISOString();
}
