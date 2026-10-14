import type { ChangeMark } from "./site-change";

const MAX_SIDE = 140;

export interface SummarisableChange {
  headline: string;
  page: string;
  mark: ChangeMark | null;
  when: string;
}

function plain(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\p{Cf}\p{Cc}]/gu, "")
    .trim();
}

function shorten(text: string): string {
  const flat = plain(text);
  const points = Array.from(flat);
  return points.length <= MAX_SIDE
    ? flat
    : `${points
        .slice(0, MAX_SIDE - 1)
        .join("")
        .trimEnd()}…`;
}

function markParts(mark: ChangeMark | null): string[] {
  if (mark === null) return [];
  return [
    ...(mark.removed === null ? [] : [`Before: “${shorten(mark.removed)}”.`]),
    ...(mark.added === null ? [] : [`After: “${shorten(mark.added)}”.`]),
  ];
}

export function changeSummary(change: SummarisableChange): string {
  const head = `${plain(change.headline).replace(/[.\s]+$/, "")} (${plain(change.page)}).`;
  return [head, ...markParts(change.mark), `Seen ${change.when}, via Five to Nine.`].join(" ");
}
