export type SnapshotKind = "ads" | "mentions" | "site" | "hiring";

export interface SnapshotCounts {
  newCreatives: number;
  copyChanges: number;
  noteworthyChanges: number;
  mentionsThatMatter: number;
  newRoles: number;
}

export interface SnapshotStanding {
  rank: number;
  movement: number | null;
}

export interface SnapshotSource {
  kind: SnapshotKind;
  name: string;
  answered: boolean;
}

export interface SnapshotInput {
  standing: SnapshotStanding | null;
  counts: SnapshotCounts;
  sources: readonly SnapshotSource[];
}

export type SnapshotCellKey =
  | "rank"
  | "new_creatives"
  | "copy_changes"
  | "site_changes"
  | "mentions"
  | "new_roles";

export interface SnapshotCell {
  key: SnapshotCellKey;
  label: string;
  value: number | null;
  movement: number | null;
  reason: string | null;
}

interface CountCellSpec {
  key: SnapshotCellKey;
  label: string;
  kind: SnapshotKind;
  count: (counts: SnapshotCounts) => number;
}

const COUNT_CELLS: readonly CountCellSpec[] = [
  {
    key: "new_creatives",
    label: "New ad creatives",
    kind: "ads",
    count: (counts) => counts.newCreatives,
  },
  {
    key: "copy_changes",
    label: "Ad copy changes",
    kind: "ads",
    count: (counts) => counts.copyChanges,
  },
  {
    key: "site_changes",
    label: "Noteworthy site changes",
    kind: "site",
    count: (counts) => counts.noteworthyChanges,
  },
  {
    key: "mentions",
    label: "Mentions that matter",
    kind: "mentions",
    count: (counts) => counts.mentionsThatMatter,
  },
  {
    key: "new_roles",
    label: "New roles",
    kind: "hiring",
    count: (counts) => counts.newRoles,
  },
];

const RANK_REASON = "Ranked when your week closes.";
const UNWATCHED_REASON = "Not watched for this brand yet.";

function rankCell(standing: SnapshotStanding | null): SnapshotCell {
  if (standing === null) {
    return { key: "rank", label: "Rank", value: null, movement: null, reason: RANK_REASON };
  }
  return {
    key: "rank",
    label: "Rank",
    value: standing.rank,
    movement: standing.movement,
    reason: null,
  };
}

function countCell(spec: CountCellSpec, input: SnapshotInput): SnapshotCell {
  const ofKind = input.sources.filter((source) => source.kind === spec.kind);
  if (ofKind.length === 0) {
    return { key: spec.key, label: spec.label, value: null, movement: null, reason: UNWATCHED_REASON };
  }
  const silent = ofKind
    .filter((source) => !source.answered)
    .map((source) => source.name);
  if (silent.length > 0) {
    const names = silent.join(", ");
    return {
      key: spec.key,
      label: spec.label,
      value: null,
      movement: null,
      reason: `${names} did not answer this week.`,
    };
  }
  return {
    key: spec.key,
    label: spec.label,
    value: spec.count(input.counts),
    movement: null,
    reason: null,
  };
}

export function snapshotCells(input: SnapshotInput): readonly SnapshotCell[] {
  return [rankCell(input.standing), ...COUNT_CELLS.map((spec) => countCell(spec, input))];
}
