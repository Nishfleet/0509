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
  const parts = [
    publishers.size > 0 ? `by ${plural(publishers.size, "publisher", "publishers")}` : null,
    threads.size > 0 ? `in ${plural(threads.size, "Hacker News thread", "Hacker News threads")}` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return "Named alongside you online";
  return `Named alongside you ${parts.join(" and ")}`;
}
