import { SOURCE_LABEL, type DevelopmentItem } from "./developments";
import type { SiteChangeView } from "./site-change";

const CHANGE_LIMIT = 5;
const MOVE_LIMIT = 5;

type TimedChange = Pick<SiteChangeView, "headline" | "url" | "mark"> & { when: string };

type TimedMove = Pick<DevelopmentItem, "kind" | "title" | "url"> & { when: string };

export interface OnePagerInput {
  name: string;
  domain: string;
  pages: number;
  lastChecked: string | null;
  changes: readonly TimedChange[];
  moves: readonly TimedMove[];
}

function changeLines(change: TimedChange): string[] {
  return [
    `- ${change.when}: ${change.headline}`,
    ...(change.mark?.removed == null ? [] : [`  Before: ${change.mark.removed}`]),
    ...(change.mark?.added == null ? [] : [`  After: ${change.mark.added}`]),
    `  ${change.url}`,
  ];
}

function moveLines(move: TimedMove): string[] {
  const label = move.title === null || move.title === "" ? SOURCE_LABEL[move.kind] : move.title;
  return [`- ${move.when}: ${SOURCE_LABEL[move.kind]}: ${label}`, ...(move.url === null ? [] : [`  ${move.url}`])];
}

function section(title: string, empty: string, lines: readonly string[]): string[] {
  return ["", title, ...(lines.length === 0 ? [empty] : lines)];
}

export function rivalOnePager(input: OnePagerInput): string {
  const read =
    input.lastChecked === null
      ? "Not read yet."
      : `Last read ${input.lastChecked}, ${String(input.pages)} ${input.pages === 1 ? "page" : "pages"} watched.`;
  return [
    `${input.name} (${input.domain})`,
    read,
    ...section("Recent site changes", "None recorded yet.", input.changes.slice(0, CHANGE_LIMIT).flatMap(changeLines)),
    ...section("Other moves", "None recorded yet.", input.moves.slice(0, MOVE_LIMIT).flatMap(moveLines)),
    "",
    "From Five to Nine",
  ].join("\n");
}
