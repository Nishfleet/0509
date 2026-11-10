import { getDomain } from "tldts";

import type { Evidence } from "./types";

const AI_ONLY_LINE = "We found this from your site's text. No news or forum mentions yet.";
const LEGACY_AI_ONLY_LINE = "Suggested from your site, not yet seen elsewhere";

export function isAiOnlyLine(line: string | null): boolean {
  return line === AI_ONLY_LINE || line === LEGACY_AI_ONLY_LINE;
}

function plural(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

export function evidenceLine(evidence: readonly Evidence[]): string {
  const publishers = new Set(
    evidence
      .filter((item) => item.generator === "news")
      .map((item) => getDomain(item.sourceUrl))
      .filter((domain): domain is string => domain !== null),
  );
  const threads = new Set(evidence.filter((item) => item.generator === "hn").map((item) => item.sourceUrl));
  const parts = [
    publishers.size > 0 ? `by ${plural(publishers.size, "publisher", "publishers")}` : null,
    threads.size > 0 ? `in ${plural(threads.size, "Hacker News thread", "Hacker News threads")}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0 && evidence.length > 0 && evidence.every((item) => item.generator === "ai")) {
    return AI_ONLY_LINE;
  }
  if (parts.length === 0) return "Named alongside you online";
  return `Named alongside you ${parts.join(" and ")}`;
}
