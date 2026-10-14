import { agoLabel } from "./ago-label";

export interface FirstLookRival {
  id: string;
  name: string;
  pages: number;
  checkedAt: string | null;
}

export interface FirstLookRow {
  id: string;
  name: string;
  line: string;
}

function firstLookLine(rival: FirstLookRival, now: Date): string {
  if (rival.checkedAt === null || rival.pages === 0) return "Reading its site now";
  const noun = rival.pages === 1 ? "page" : "pages";
  return `Read ${String(rival.pages)} ${noun}, ${agoLabel(rival.checkedAt, now)}`;
}

export function firstLookRows(rivals: readonly FirstLookRival[], now: Date): FirstLookRow[] {
  return rivals.map((rival) => ({ id: rival.id, name: rival.name, line: firstLookLine(rival, now) }));
}
