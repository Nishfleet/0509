import { describe, expect, it } from "vitest";

import {
  snapshotCells,
  type SnapshotCell,
  type SnapshotCellKey,
  type SnapshotCounts,
  type SnapshotInput,
  type SnapshotKind,
  type SnapshotSource,
  type SnapshotStanding,
} from "../../app/lib/competitor-snapshot";

const COUNTS: SnapshotCounts = {
  newCreatives: 3,
  copyChanges: 1,
  noteworthyChanges: 2,
  mentionsThatMatter: 5,
  newRoles: 4,
};

const ALL_ANSWERED: readonly SnapshotSource[] = [
  { kind: "ads", name: "Meta ads library", answered: true },
  { kind: "site", name: "Own site sweeper", answered: true },
  { kind: "mentions", name: "Hacker News", answered: true },
  { kind: "hiring", name: "Greenhouse", answered: true },
];

const RANKED: SnapshotStanding = { rank: 2, movement: -1 };

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    standing: RANKED,
    counts: COUNTS,
    sources: ALL_ANSWERED,
    ...overrides,
  };
}

function cellOf(cells: readonly SnapshotCell[], key: string): SnapshotCell | undefined {
  return cells.find((cell) => cell.key === key);
}

const EXPECTED_KEYS: readonly SnapshotCellKey[] = [
  "rank",
  "new_creatives",
  "copy_changes",
  "site_changes",
  "mentions",
  "new_roles",
];

const SOURCE_KINDS: readonly SnapshotKind[] = ["ads", "mentions", "site", "hiring"];

describe("snapshotCells", () => {
  it("returns the six keys in the fixed order", () => {
    expect(snapshotCells(input()).map((cell) => cell.key)).toEqual([...EXPECTED_KEYS]);
  });

  it("names all four source kinds", () => {
    expect(SOURCE_KINDS).toEqual(["ads", "mentions", "site", "hiring"]);
  });

  it("labels the six cells", () => {
    expect(snapshotCells(input()).map((cell) => cell.label)).toEqual([
      "Rank",
      "New ad creatives",
      "Ad copy changes",
      "Noteworthy site changes",
      "Mentions that matter",
      "New roles",
    ]);
  });

  it("pairs each count cell with its count field only", () => {
    const cells = snapshotCells(input());
    expect(cellOf(cells, "new_creatives")?.value).toBe(3);
    expect(cellOf(cells, "copy_changes")?.value).toBe(1);
    expect(cellOf(cells, "site_changes")?.value).toBe(2);
    expect(cellOf(cells, "mentions")?.value).toBe(5);
    expect(cellOf(cells, "new_roles")?.value).toBe(4);
  });

  it("carries the rank and its movement through", () => {
    expect(cellOf(snapshotCells(input()), "rank")).toEqual({
      key: "rank",
      label: "Rank",
      value: 2,
      movement: -1,
      reason: null,
    });
  });

  it("dashes the rank with its reason when no week has closed yet", () => {
    expect(cellOf(snapshotCells(input({ standing: null })), "rank")).toEqual({
      key: "rank",
      label: "Rank",
      value: null,
      movement: null,
      reason: "Ranked when your week closes.",
    });
  });

  it("keeps a zero count as a real 0, never a dash", () => {
    const cells = snapshotCells(input({ counts: { ...COUNTS, newCreatives: 0 } }));
    expect(cellOf(cells, "new_creatives")).toEqual({
      key: "new_creatives",
      label: "New ad creatives",
      value: 0,
      movement: null,
      reason: null,
    });
  });

  it("dashes a kind no source watches and says so", () => {
    const cells = snapshotCells(
      input({ sources: [{ kind: "ads", name: "Meta ads library", answered: true }] }),
    );
    expect(cellOf(cells, "site_changes")).toEqual({
      key: "site_changes",
      label: "Noteworthy site changes",
      value: null,
      movement: null,
      reason: "Not watched for this brand yet.",
    });
    expect(cellOf(cells, "mentions")?.reason).toBe("Not watched for this brand yet.");
    expect(cellOf(cells, "new_roles")?.reason).toBe("Not watched for this brand yet.");
  });

  it("dashes both ads cells when one ads source did not answer, naming only that source", () => {
    const cells = snapshotCells(
      input({
        sources: [
          { kind: "ads", name: "Meta ads library", answered: true },
          { kind: "ads", name: "TikTok creative center", answered: false },
          { kind: "site", name: "Own site sweeper", answered: true },
          { kind: "mentions", name: "Hacker News", answered: true },
          { kind: "hiring", name: "Greenhouse", answered: true },
        ],
      }),
    );
    expect(cellOf(cells, "new_creatives")).toEqual({
      key: "new_creatives",
      label: "New ad creatives",
      value: null,
      movement: null,
      reason: "TikTok creative center did not answer this week.",
    });
    expect(cellOf(cells, "copy_changes")).toEqual({
      key: "copy_changes",
      label: "Ad copy changes",
      value: null,
      movement: null,
      reason: "TikTok creative center did not answer this week.",
    });
  });

  it("joins two unanswered names with ', '", () => {
    const cells = snapshotCells(
      input({
        sources: [
          { kind: "ads", name: "Meta ads library", answered: false },
          { kind: "ads", name: "TikTok creative center", answered: false },
          { kind: "site", name: "Own site sweeper", answered: true },
          { kind: "mentions", name: "Hacker News", answered: true },
          { kind: "hiring", name: "Greenhouse", answered: true },
        ],
      }),
    );
    expect(cellOf(cells, "new_creatives")?.reason).toBe(
      "Meta ads library, TikTok creative center did not answer this week.",
    );
  });

  it("names unanswered sources in input order", () => {
    const cells = snapshotCells(
      input({
        sources: [
          { kind: "ads", name: "Zillow later source", answered: false },
          { kind: "ads", name: "Alpha first source", answered: false },
          { kind: "site", name: "Own site sweeper", answered: true },
          { kind: "mentions", name: "Hacker News", answered: true },
          { kind: "hiring", name: "Greenhouse", answered: true },
        ],
      }),
    );
    expect(cellOf(cells, "copy_changes")?.reason).toBe(
      "Zillow later source, Alpha first source did not answer this week.",
    );
  });

  it("always sets movement to null on a count cell", () => {
    for (const cell of snapshotCells(input())) {
      if (cell.key === "rank") continue;
      expect(cell.movement).toBe(null);
    }
  });

  it("never mutates the input", () => {
    const standing = { rank: 2, movement: -1 };
    const counts = { ...COUNTS };
    const sources = ALL_ANSWERED.map((source) => ({ ...source }));
    snapshotCells({ standing, counts, sources });
    expect(standing).toEqual({ rank: 2, movement: -1 });
    expect(counts).toEqual(COUNTS);
    expect(sources).toEqual(ALL_ANSWERED);
  });
});
