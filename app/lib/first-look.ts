import { agoLabel } from "./ago-label";
import { baselineLines, type RivalFacts } from "./rival-baseline";

export interface FirstLookRival {
  id: string;
  name: string;
  pages: number;
  checkedAt: string | null;
  blocked: boolean;
}

export interface FirstLookRow {
  id: string;
  name: string;
  line: string;
  facts?: readonly string[];
}

function firstLookLine(rival: FirstLookRival, now: Date): string {
  if (rival.checkedAt === null || rival.pages === 0) {
    return rival.blocked
      ? "Its site didn't open for us yet. We try again on the next nightly read"
      : "Reading its site now";
  }
  const noun = rival.pages === 1 ? "page" : "pages";
  return `Read ${String(rival.pages)} ${noun}, ${agoLabel(rival.checkedAt, now)}`;
}

export function firstLookRows(
  rivals: readonly FirstLookRival[],
  now: Date,
  facts: ReadonlyMap<string, RivalFacts> = new Map(),
): FirstLookRow[] {
  return rivals.map((rival) => {
    const found = facts.get(rival.id);
    return {
      id: rival.id,
      name: rival.name,
      line: firstLookLine(rival, now),
      ...(found === undefined ? {} : { facts: baselineLines(found, "UTC", { watched: false }) }),
    };
  });
}
