import type { ChangeMark } from "./site-change";

const MAX_SIDE = 140;

export interface SummarisableChange {
  headline: string;
  page: string;
  mark: ChangeMark | null;
  when: string;
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_SIDE ? flat : `${flat.slice(0, MAX_SIDE - 1).trimEnd()}…`;
}

function markParts(mark: ChangeMark | null): string[] {
  if (mark === null) return [];
  return [
    ...(mark.removed === null ? [] : [`Before: “${shorten(mark.removed)}”.`]),
    ...(mark.added === null ? [] : [`After: “${shorten(mark.added)}”.`]),
  ];
}

export function changeSummary(change: SummarisableChange): string {
  const head = `${change.headline.replace(/[.\s]+$/, "")} (${change.page}).`;
  return [head, ...markParts(change.mark), `Seen ${change.when}, via Five to Nine.`].join(" ");
}
