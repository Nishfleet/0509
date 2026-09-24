import { describe, expect, it } from "vitest";

import {
  captureLabel,
  changeHeadline,
  MARK_MAX_CHARS,
  markFromHunks,
  parseDiffHunks,
  parseSiteChangePayload,
  wordsSentence,
} from "../../app/lib/site-change";

describe("a site change, as a customer reads it", () => {
  it("names who changed which page", () => {
    expect(changeHeadline({ name: "Bramble", isSelf: false, role: "home" })).toBe("Bramble changed its homepage");
    expect(changeHeadline({ name: "Bramble", isSelf: false, role: "pricing" })).toBe(
      "Bramble changed its pricing page",
    );
    expect(changeHeadline({ name: "Bramble", isSelf: false, role: "other" })).toBe("Bramble changed its website");
    expect(changeHeadline({ name: "Mine", isSelf: true, role: "home" })).toBe("Your homepage changed");
  });

  it("strikes the first removed sentence and marks the first added one from the same hunk", () => {
    const hunks = [
      [" Rival", "+New: team seats."],
      [" Rival", "-Plans start at ten dollars a month.", "+Plans start at twelve dollars a month."],
    ];
    expect(markFromHunks(hunks)).toEqual({
      removed: "Plans start at ten dollars a month.",
      added: "Plans start at twelve dollars a month.",
    });
  });

  it("falls back to a one-sided mark, and to none when nothing was said", () => {
    expect(markFromHunks([[" context", "+Now shipping to Canada."]])).toEqual({
      removed: null,
      added: "Now shipping to Canada.",
    });
    expect(markFromHunks([[" context", "-Free returns."]])).toEqual({ removed: "Free returns.", added: null });
    expect(markFromHunks([[" context only", "+   "]])).toBeNull();
    expect(markFromHunks([])).toBeNull();
  });

  it("clips a long sentence so the mark stays a line, not a page", () => {
    const long = "word ".repeat(100);
    const mark = markFromHunks([[`-${long}`, `+${long}`]]);
    expect(mark?.removed?.length).toBeLessThanOrEqual(MARK_MAX_CHARS);
    expect(mark?.removed?.endsWith("…")).toBe(true);
  });

  it("counts words in plain English", () => {
    expect(wordsSentence(12, 3)).toBe("12 words added, 3 removed.");
    expect(wordsSentence(1, 0)).toBe("1 word added.");
    expect(wordsSentence(0, 4)).toBe("4 words removed.");
    expect(wordsSentence(0, 0)).toBe("The wording moved around.");
  });

  it("labels a capture in UTC, in a form the mark can read back", () => {
    const label = captureLabel("2026-09-24T02:14:09.000Z");
    expect(label).toBe("2026-09-24 02:14 UTC");
    expect(new Date(Date.parse(label)).toISOString()).toBe("2026-09-24T02:14:00.000Z");
  });

  it("reads the stored payload and hunks, and refuses anything else", () => {
    const payload = {
      page: { role: "home", url: "https://rival.com/" },
      before: { snapshotId: "a", textKey: "k", screenshotKey: null },
      after: { snapshotId: "b", textKey: "k2", screenshotKey: "snapshot/site/w/b.png" },
      diffKey: null,
      wordsAdded: 2,
      wordsRemoved: 1,
      status: 200,
      transport: "fetch",
    };
    expect(parseSiteChangePayload(JSON.stringify(payload))?.after.screenshotKey).toBe("snapshot/site/w/b.png");
    expect(parseSiteChangePayload("{not json")).toBeNull();
    expect(parseSiteChangePayload(JSON.stringify({ page: {} }))).toBeNull();
    expect(parseDiffHunks(JSON.stringify({ hunks: [{ lines: ["-a", "+b"], oldStart: 1 }] }))).toEqual([["-a", "+b"]]);
    expect(parseDiffHunks("[]")).toBeNull();
  });
});
