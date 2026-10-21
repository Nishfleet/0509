import { agoLabel } from "./ago-label";
import { baselineLines, type RivalFacts } from "./rival-baseline";

export interface FirstLookRival {
  id: string;
  name: string;
  pages: number;
  checkedAt: string | null;
  unreadable: boolean;
}

export interface FirstLookRow {
  id: string;
  name: string;
  line: string;
  pending: boolean;
  facts?: readonly string[];
}

const UNREADABLE_LINE = "We couldn't read their website. We keep trying.";

const FIRST_READ_LINE = "First read tonight";

function readAttempted(rival: FirstLookRival): boolean {
  return rival.unreadable && rival.pages === 0;
}

export function isFirstRun(rows: readonly FirstLookRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.pending);
}

export function withFirstReadWindow(rows: readonly FirstLookRow[], window: string): FirstLookRow[] {
  return rows.map((row) => (row.pending ? { ...row, line: `${FIRST_READ_LINE} ${window}` } : row));
}

function firstLookLine(rival: FirstLookRival, now: Date): string {
  if (readAttempted(rival)) return UNREADABLE_LINE;
  if (rival.checkedAt === null || rival.pages === 0) return FIRST_READ_LINE;
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
    const line = firstLookLine(rival, now);
    return {
      id: rival.id,
      name: rival.name,
      line,
      pending: line === FIRST_READ_LINE,
      ...(found === undefined ? {} : { facts: baselineLines(found, "UTC", { watched: false }) }),
    };
  });
}
