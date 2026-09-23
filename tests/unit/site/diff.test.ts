import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { countWords, diffPageText, isEmptyDiff } from "../../../app/lib/site/diff";
import { extractPageText, hasChanged } from "../../../app/lib/site/extract-text";
import {
  buildStoredDiff,
  diffHunksKey,
  r2SiteArtifacts,
  screenshotKey,
  snapshotTextKey,
} from "../../../app/lib/site/marks";
import copyAfter from "../../fixtures/copy-change-after.html?raw";
import copyBefore from "../../fixtures/copy-change-before.html?raw";
import gymA from "../../fixtures/gymshark-2026-09-22-a.html?raw";
import gymB from "../../fixtures/gymshark-2026-09-22-b.html?raw";

const wordAt = (text: string, index: number): string | undefined => text.split(/\s+/)[index];

describe("diffPageText", () => {
  it("returns no changes and no hunks for identical text", () => {
    const diff = diffPageText("same words here", "same words here");

    expect(diff.changes).toEqual([]);
    expect(diff.hunks).toEqual([]);
    expect(diff.addedWords).toBe(0);
    expect(diff.removedWords).toBe(0);
    expect(isEmptyDiff(diff)).toBe(true);
  });

  it("folds a replacement into one change and one hunk that share a word offset", () => {
    const diff = diffPageText("Summer drop is live", "Winter drop is live");

    expect(diff.changes).toEqual([{ before: "Summer", after: "Winter", atWord: 0 }]);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0]?.atWord).toBe(0);
    expect(diff.addedWords).toBe(1);
    expect(diff.removedWords).toBe(1);
    expect(isEmptyDiff(diff)).toBe(false);
  });

  it("offsets a change by the words before it, and the hunk agrees", () => {
    const before = "alpha beta gamma";

    const diff = diffPageText(before, "alpha delta gamma");

    expect(diff.changes).toEqual([{ before: "beta", after: "delta", atWord: 1 }]);
    expect(diff.hunks[0]?.atWord).toBe(1);
    const offset = diff.changes[0]?.atWord;
    expect(offset).toBeDefined();
    expect(wordAt(before, offset ?? 0)).toBe("beta");
  });

  it("keeps an adjacent replacement to one change, as jsdiff merges them", () => {
    const diff = diffPageText("alpha beta gamma", "alpha delta epsilon");

    expect(diff.changes).toEqual([
      { before: "beta gamma", after: "delta epsilon", atWord: 1 },
    ]);
    expect(diff.hunks).toHaveLength(1);
  });

  it("counts an insertion as an added word with an empty before", () => {
    const diff = diffPageText("Price is 50", "Price is now 50");

    expect(diff.changes).toEqual([{ before: "", after: "now", atWord: 2 }]);
    expect(diff.addedWords).toBe(1);
    expect(diff.removedWords).toBe(0);
    expect(diff.hunks[0]?.lines).toEqual([" Price", " is", "+now", " 50"]);
  });

  it("counts a deletion as a removed word with an empty after", () => {
    const diff = diffPageText("Free shipping today", "Free shipping");

    expect(diff.changes).toEqual([{ before: "today", after: "", atWord: 2 }]);
    expect(diff.addedWords).toBe(0);
    expect(diff.removedWords).toBe(1);
  });

  it("separates two distant changes, each offset from its own preceding words", () => {
    const before = "a b c d e f g h i j";

    const diff = diffPageText(before, "A b c d e f g h i J");

    expect(diff.changes).toEqual([
      { before: "a", after: "A", atWord: 0 },
      { before: "j", after: "J", atWord: 9 },
    ]);
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0]?.atWord).toBe(0);
    expect(diff.hunks[1]?.atWord).toBe(9);
    expect(wordAt(before, diff.changes[1]?.atWord ?? 0)).toBe("j");
  });

  it("diffs the real gymshark pair to nothing, because the hash gate never escalates it", async () => {
    const a = await extractPageText(gymA);
    const b = await extractPageText(gymB);

    expect(hasChanged(a.hash, b.hash)).toBe(false);
    expect(isEmptyDiff(diffPageText(a.text, b.text))).toBe(true);
  });

  it("diffs the real one-word copy change to exactly that word", async () => {
    const a = await extractPageText(copyBefore);
    const b = await extractPageText(copyAfter);

    expect(hasChanged(a.hash, b.hash)).toBe(true);
    const diff = diffPageText(a.text, b.text);

    expect(diff.changes).toEqual([{ before: "Summer", after: "Winter", atWord: 1 }]);
    expect(diff.addedWords).toBe(1);
    expect(diff.removedWords).toBe(1);
    expect(wordAt(a.text, diff.changes[0]?.atWord ?? 0)).toBe("Summer");
    expect(wordAt(b.text, diff.changes[0]?.atWord ?? 0)).toBe("Winter");
  });
});

describe("countWords", () => {
  it("counts whitespace-separated words and treats blank as zero", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
    expect(countWords("one")).toBe(1);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  one   two  ")).toBe(2);
  });
});

describe("site R2 marks", () => {
  const artifacts = r2SiteArtifacts(env.CARD_ARTIFACTS);

  it("keys are scoped by tenant, entity, page and instant", () => {
    const opts = {
      workspaceId: "ws1",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T00:00:00Z",
    };

    expect(snapshotTextKey(opts)).toBe("site/text/ws1/e1/p1/2026-09-23T00:00:00Z.txt");
    expect(screenshotKey({ ...opts, when: "2026-09-23", side: "before" })).toBe(
      "site/screens/ws1/e1/p1/2026-09-23-before.png",
    );
    expect(diffHunksKey(opts)).toBe("site/diffs/ws1/e1/p1/2026-09-23T00:00:00Z.json");
  });

  it("buildStoredDiff references the hunk body and both screenshots by key, never inline", () => {
    const stored = buildStoredDiff({
      workspaceId: "ws1",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T00:00:00Z",
      screenshot: {
        before: "site/screens/ws1/e1/p1/before.png",
        after: "site/screens/ws1/e1/p1/after.png",
      },
    });

    expect(stored).toEqual({
      diffR2Key: "site/diffs/ws1/e1/p1/2026-09-23T00:00:00Z.json",
      screenshotR2Keys: {
        before: "site/screens/ws1/e1/p1/before.png",
        after: "site/screens/ws1/e1/p1/after.png",
      },
      capturedAt: "2026-09-23T00:00:00Z",
    });
  });

  it("round-trips an extracted text through the real R2 binding by key", async () => {
    const page = await extractPageText(copyBefore);
    const key = snapshotTextKey({
      workspaceId: "ws-marks",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T06:00:00.000Z",
    });

    await artifacts.putText(key, page.text, "2026-09-23T06:00:00.000Z");

    expect(await artifacts.getText(key)).toBe(page.text);
    const object = await env.CARD_ARTIFACTS.get(key);
    expect(object?.customMetadata?.captured_at).toBe("2026-09-23T06:00:00.000Z");
  });

  it("round-trips a real diff body keyed by the diff instant", async () => {
    const before = await extractPageText(copyBefore);
    const after = await extractPageText(copyAfter);
    const diff = diffPageText(before.text, after.text);
    const key = diffHunksKey({
      workspaceId: "ws-marks",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T06:00:01.000Z",
    });

    await artifacts.putDiffHunks(key, diff, "2026-09-23T06:00:01.000Z");

    expect(await artifacts.getDiffHunks(key)).toEqual(diff);
    const stored = await env.CARD_ARTIFACTS.get(key);
    const raw = await stored?.text();

    expect(raw).toBe(JSON.stringify(diff));
    expect(stored?.size).toBe(new TextEncoder().encode(raw ?? "").byteLength);
    expect(stored?.customMetadata?.captured_at).toBe("2026-09-23T06:00:01.000Z");
    expect(diff.changes).toEqual([{ before: "Summer", after: "Winter", atWord: 1 }]);
    expect(diff.hunks).toHaveLength(1);
  });

  it("rejects an R2 body that is not a PageDiff instead of casting it", async () => {
    const key = diffHunksKey({
      workspaceId: "ws-marks",
      entityId: "e1",
      pageId: "p1",
      fetchedAt: "2026-09-23T06:00:02.000Z",
    });

    await env.CARD_ARTIFACTS.put(key, JSON.stringify({ changes: [], hunks: [{}] }));

    await expect(artifacts.getDiffHunks(key)).rejects.toThrow();
  });

  it("returns null for a missing key rather than throwing", async () => {
    expect(await artifacts.getText("site/text/ws-marks/e1/p1/missing.txt")).toBeNull();
    expect(await artifacts.getDiffHunks("site/diffs/ws-marks/e1/p1/missing.json")).toBeNull();
  });
});
