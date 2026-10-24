import type { PlanId } from "./plans";
import { type CoverageId, isLive } from "../coverage";

const INCLUDES: Record<PlanId, readonly (string | { line: string; needs: CoverageId })[]> = {
  scout: [
    "5 competitors watched at once",
    { line: "Homepage changes", needs: "site.home" },
    { line: "Pricing page changes", needs: "site.pricing" },
    "90 days of before-and-afters",
    "4 weeks of standing history",
    "Read-only API and MCP",
  ],
  starter: [
    "Everything in Scout, plus",
    "15 competitors watched at once",
    { line: "Every page we find, checked for changes", needs: "site.all" },
    { line: "Alerts the moment your own site breaks", needs: "own.breakage" },
    { line: "Google Search results and LinkedIn ads", needs: "ads.linkedin" },
    "A year of before-and-afters and standing",
  ],
  agency: [
    "Everything in Starter, plus",
    "50 competitors per workspace",
    "Unlimited client brands (fair use 25, more on request)",
  ],
};

export function planIncludes(plan: PlanId): string[] {
  return INCLUDES[plan].flatMap((entry) =>
    typeof entry === "string" ? [entry] : isLive(entry.needs) ? [entry.line] : [],
  );
}
