import { describe, expect, it } from "vitest";

import {
  ALERT_CHIPS,
  chipOfKind,
  countAlertChips,
  itemInChip,
  parseAlertChip,
  type AlertItemKind,
} from "../../app/lib/alert-chips";

describe("ALERT_CHIPS", () => {
  it("lists All, then the three filtered chips, then the two count-only chips", () => {
    expect(ALERT_CHIPS.map((chip) => chip.key)).toEqual([
      "all",
      "site-changes",
      "ads",
      "mentions",
      "hiring",
      "your-site",
    ]);
    expect(ALERT_CHIPS.map((chip) => chip.label)).toEqual([
      "All",
      "Site changes",
      "Ads",
      "Mentions",
      "Hiring",
      "Your site",
    ]);
  });
});

describe("parseAlertChip", () => {
  it("returns All for a null or unknown kind", () => {
    expect(parseAlertChip(null)).toBe("all");
    expect(parseAlertChip("bogus")).toBe("all");
    expect(parseAlertChip("")).toBe("all");
  });

  it("returns the named chip for every key the list carries", () => {
    for (const chip of ALERT_CHIPS) {
      expect(parseAlertChip(chip.key)).toBe(chip.key);
    }
    expect(parseAlertChip("ads")).toBe("ads");
  });
});

describe("chipOfKind", () => {
  it("maps each kind to its chip, and note and failure to none", () => {
    const expected: [AlertItemKind, string | null][] = [
      ["change", "site-changes"],
      ["signal", "ads"],
      ["mention", "mentions"],
      ["note", null],
      ["failure", null],
    ];
    for (const [kind, chip] of expected) {
      expect(chipOfKind(kind)).toBe(chip);
    }
  });
});

describe("itemInChip", () => {
  it("keeps every kind under All and only the mapped kind under a named chip", () => {
    expect(itemInChip("note", "all")).toBe(true);
    expect(itemInChip("note", "ads")).toBe(false);
    expect(itemInChip("signal", "ads")).toBe(true);
    expect(itemInChip("signal", "mentions")).toBe(false);
  });

  it("shows no feed rows for the two count-only chips", () => {
    expect(itemInChip("change", "hiring")).toBe(false);
    expect(itemInChip("mention", "your-site")).toBe(false);
  });
});

describe("countAlertChips", () => {
  it("counts All with incidents, each filtered chip from the kinds, and Hiring as zero", () => {
    expect(countAlertChips(["change", "signal", "signal", "mention", "note", "failure"], 1)).toEqual({
      all: 7,
      "site-changes": 1,
      ads: 2,
      mentions: 1,
      hiring: 0,
      "your-site": 1,
    });
  });

  it("returns a fresh object every call with zero counts for an empty feed", () => {
    const empty = countAlertChips([], 0);
    expect(empty).toEqual({
      all: 0,
      "site-changes": 0,
      ads: 0,
      mentions: 0,
      hiring: 0,
      "your-site": 0,
    });
    const other = countAlertChips([], 0);
    expect(other).not.toBe(empty);
    other.hiring = 5;
    expect(countAlertChips([], 0).hiring).toBe(0);
  });
});
