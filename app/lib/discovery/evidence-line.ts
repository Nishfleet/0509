import { getDomain } from "tldts";

import type { Evidence } from "./types";

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
  const ads = evidence.filter((item) => item.generator === "ads").length;
  if (publishers.size === 0 && threads.size === 0) {
    return ads > 0 ? "Advertises in the same category" : "Named alongside you online";
  }
  const parts = [
    publishers.size > 0 ? `by ${plural(publishers.size, "publisher", "publishers")}` : null,
    threads.size > 0 ? `in ${plural(threads.size, "Hacker News thread", "Hacker News threads")}` : null,
    ads > 0 ? "advertises in the same category" : null,
  ].filter((part): part is string => part !== null);
  return `Named alongside you ${parts.join(" and ")}`;
}
