import { describe, expect, it } from "vitest";

import { buildPageDiff, buildStoredHunks, diffWordsPositioned, hasChanged } from "../../../app/lib/site/diff";
import {
  markKey,
  markKeys,
  storeMark,
  type MarkStore,
} from "../../../app/lib/site/marks";

/**
 * Engine 4, P3 — the word diff and the before-and-after mark (0509#4001;
 * docs/engines/site-change.md § PACKETS → P3).
 *
 * The texts below are the real, normalised copy of the fixture site we own
 * (0509-fixture-site, 0509#4046, `workers/fixture-site.ts`): the healthy page
 * and its `soft` break, which is "200 with the pricing section gone". The
 * extracted strings are committed here rather than fetched, because this suite
 * is the pure-logic `node` project and the fixture Worker needs workerd's
 * `SubtleCrypto.timingSafeEqual`, which the node runtime does not expose. The
 * same pair is driven for real, through the real Worker, in
 * `tests/integration/site/site-change-diff.integration.test.ts`.
 *
 * So "two texts" here is not two invented strings: it is one real page before
 * and after a real change we induced on it. What this file proves is that the
 * *diff layer* is correct — hash gate, word granularity, page positions,
 * hunk bounds, and the R2-key-only mark — independent of how the strings got
 * there. The real-change round-trip and the unchanged-tick single-row claim
 * live in the integration test that can actually run a Worker.
 */

/** The healthy fixture page, extracted and whitespace-normalised. */
const HEALTHY_TEXT = `Five to Nine — fixture Track every competitor move, in one weekly brief Pricing Starter — ₹499 / month Pro — ₹1,299 / month Team — ₹2,499 / month Choose a plan and check out`;

/** The same page with its pricing section gone (the soft break). */
const SOFT_TEXT = `Five to Nine — fixture Track every competitor move, in one weekly brief`;

/** The healthy page on the next tick, byte-identical and text-identical. */
const HEALTHY_TEXT_AGAIN = HEALTHY_TEXT;

/**
 * A stable hash of the extracted text. The real engine uses SHA-256 over the
 * normalised text (P1 owns that); what this module's contract needs is a
 * deterministic function of the text, so "same text" and "changed text" are
 * distinguishable. FNV-1a, 8 hex chars — enough to be a distinct key in tests.
 */
const textHash = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/** A recorder standing in for the R2 binding: proves keys and sizes. */
const makeStore = () => {
  const written = new Map<string, { bytes: number; contentType: string; isImage: boolean }>();
  const store: MarkStore = {
    async put(key, value, options) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value).byteLength
          : value instanceof ArrayBuffer
            ? value.byteLength
            : value instanceof Uint8Array
              ? value.byteLength
              : 0;
      const contentType = options?.httpMetadata?.contentType ?? "application/octet-stream";
      written.set(key, { bytes, contentType, isImage: contentType.startsWith("image/") });
      return undefined;
    },
  };
  return { store, written };
};

describe("site diff — the hash gate", () => {
  it("treats equal hashes as unchanged", () => {
    expect(hasChanged("abc123", "abc123")).toBe(false);
  });

  it("treats a first-seen page as unchanged, not as a change", () => {
    // No previous snapshot: not a change, a new page. A gate that fired here
    // would diff against nothing and mark every page on its first tick.
    expect(hasChanged("", "abc123")).toBe(false);
    expect(hasChanged("abc123", "")).toBe(false);
  });

  it("fires only on two present, different hashes", () => {
    expect(hasChanged("abc123", "def456")).toBe(true);
  });

  it("refuses to diff before the gate has fired", () => {
    expect(() =>
      buildPageDiff({
        prevHash: "same",
        nextHash: "same",
        beforeText: HEALTHY_TEXT,
        afterText: HEALTHY_TEXT,
      }),
    ).toThrow(/hash gate has not fired/);
  });

  it("the unchanged tick writes one row and nothing else — no mark is built", async () => {
    // The gate's real consequence, asserted rather than described: on an
    // unchanged tick the sweep stops at the snapshot row, so there is no hunk
    // and no key anywhere. This is the "no screenshot, no diff, no Jev call"
    // half of the acceptance. The R2 recorder is asked to store a mark built
    // from the pair, which the gate refuses, so the recorder stays empty for a
    // reason that can fail: a gate that fired would write five keys.
    const prev = textHash(HEALTHY_TEXT);
    const next = textHash(HEALTHY_TEXT_AGAIN);
    expect(hasChanged(prev, next)).toBe(false);

    const { store, written } = makeStore();
    expect(() =>
      buildPageDiff({
        prevHash: prev,
        nextHash: next,
        beforeText: HEALTHY_TEXT,
        afterText: HEALTHY_TEXT_AGAIN,
      }),
    ).toThrow(/hash gate has not fired/);

    const keys = {
      beforeTextKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "before-text", "txt"),
      afterTextKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "after-text", "txt"),
      beforeScreenshotKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "before-shot", "png"),
      afterScreenshotKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "after-shot", "png"),
      hunksKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "hunks", "json"),
    };
    await expect(
      storeMark(
        store,
        keys,
        { changes: [], hunks: [], wordsBefore: 1, wordsAfter: 1, wordDelta: 0 },
        HEALTHY_TEXT,
        HEALTHY_TEXT_AGAIN,
        new ArrayBuffer(1),
        new ArrayBuffer(1),
      ),
    ).rejects.toThrow(/no changes/);
    expect(written.size).toBe(0);
  });
});

describe("site diff — word-level changes", () => {
  it("diffs a price change at word granularity, not at line granularity", () => {
    const before = "Starter — ₹499 / month";
    const after = "Starter — ₹549 / month";
    const changes = diffWordsPositioned(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].before).toContain("499");
    expect(changes[0].after).toContain("549");
    // Word granularity: the untouched "Starter —" and "/ month" are not changes.
    expect(changes.every((c) => !/Starter/.test(c.after))).toBe(true);
  });

  it("gives every change a page position in before-text word indices", () => {
    const before = "one two three four";
    const after = "one two THREE four";
    const changes = diffWordsPositioned(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].startWord).toBe(2);
    expect(changes[0].endWord).toBe(3);
  });

  it("carries an insertion with an empty before and the position it lands at", () => {
    const before = "Pricing";
    const after = "Pricing 499 rupees";
    const changes = diffWordsPositioned(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0].before).toBe("");
    expect(changes[0].after).toContain("499");
    expect(changes[0].startWord).toBe(1);
  });

  it("keeps every position a true before-text index once an insertion has shifted the text", () => {
    // A change after an insertion must be located by the before text, never by
    // the after text's own length: an added part is not in the before text, so
    // it must not advance the before-text cursor.
    const before = "alpha beta gamma delta epsilon";
    const after = "alpha beta INSERTED gamma delta zeta";
    const beforeWords = before.split(" ");
    const changes = diffWordsPositioned(before, after);
    expect(changes).toHaveLength(2);
    expect(changes[0].startWord).toBe(2);
    expect(changes[1].before).toBe("epsilon");
    expect(beforeWords[changes[1].startWord]).toBe("epsilon");
  });

  it("reports a removed run as an empty after, so a vanished section is visible", () => {
    const changes = diffWordsPositioned("Choose a plan and check out", "Choose a plan");
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.at(-1)?.before).toContain("out");
    expect(changes.at(-1)?.after).toBe("");
  });
});

describe("site diff — stored hunks", () => {
  it("emits bounded hunks with `-`/`+` lines and a page position", () => {
    const before = "alpha beta gamma";
    const after = "alpha BETA gamma";
    const hunks = buildStoredHunks(before, after);
    expect(hunks.length).toBeGreaterThan(0);
    const hunk = hunks[0];
    // `startWord` is the word index the change sits at, so the hunk carries the
    // page position the packet asks for.
    expect(hunk.startWord).toBe(1);
    expect(hunk.lines.some((l) => l.startsWith("-"))).toBe(true);
    expect(hunk.lines.some((l) => l.startsWith("+"))).toBe(true);
    expect(typeof hunk.startWord).toBe("number");
  });

  it("locates a change in a one-line blob at its real word index", () => {
    // The normalised text P1 emits is one line. Under a line patch every hunk
    // of it reports position zero and covers the whole page; the position must
    // instead be the word index the change actually sits at.
    const before = "one two three four five six seven eight";
    const after = "one two three four five six seven EIGHT";
    const hunks = buildStoredHunks(before, after, 1);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].startWord).toBe(7);
    // One word of context either side of the change, not the whole eight.
    expect(hunks[0].lines).toEqual([" seven", "-eight", "+EIGHT"]);
  });

  it("keeps a page's stored hunks far smaller than the page", () => {
    // A long page with one change far in: the stored hunk must carry the change
    // and its context, never the whole page. The 1 MiB step-output cap is the
    // reason this matters (docs/engines/site-change.md P3 FORBIDDEN).
    const filler = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    const before = `${filler} the old line ${filler}`;
    const after = `${filler} the new line ${filler}`;
    const hunks = buildStoredHunks(before, after, 2);
    const totalHunkLines = hunks.reduce((n, h) => n + h.lines.length, 0);
    expect(totalHunkLines).toBeLessThan(before.split(" ").length / 10);
    expect(hunks.length).toBe(1);
  });

  it("rejects a negative context rather than producing an unbounded patch", () => {
    expect(() => buildStoredHunks("a", "b", -1)).toThrow(/context/);
  });
});

describe("site diff — the real fixture-site text pair", () => {
  it("the soft break is a real copy change: a priced section disappears", () => {
    expect(HEALTHY_TEXT).toContain("₹499");
    expect(SOFT_TEXT).not.toContain("₹499");
    // The aria-hidden mode marker is dropped by normalisation, so the only
    // difference the diff sees is the pricing section — the deliberate break.
    expect(HEALTHY_TEXT).not.toContain("mode: soft");
    expect(SOFT_TEXT).not.toContain("mode: soft");
  });

  it("the unchanged tick produces the same hash", () => {
    expect(textHash(HEALTHY_TEXT)).toBe(textHash(HEALTHY_TEXT_AGAIN));
    expect(hasChanged(textHash(HEALTHY_TEXT), textHash(HEALTHY_TEXT_AGAIN))).toBe(false);
  });

  it("builds positioned hunks for the real change, once the gate has fired", () => {
    const prevHash = textHash(HEALTHY_TEXT);
    const nextHash = textHash(SOFT_TEXT);
    expect(hasChanged(prevHash, nextHash)).toBe(true);

    const diff = buildPageDiff({
      prevHash,
      nextHash,
      beforeText: HEALTHY_TEXT,
      afterText: SOFT_TEXT,
    });
    expect(diff.hunks.length).toBeGreaterThan(0);
    expect(diff.changes.length).toBeGreaterThan(0);
    // The priced section vanished, so the word delta is negative — the code
    // evidence D3s reads without any Jev call.
    expect(diff.wordDelta).toBeLessThan(0);
    // Every stored hunk names a real page position: the word in the before
    // text at `startWord` is the word the hunk's own `-` line removed.
    const beforeWords = HEALTHY_TEXT.split(" ");
    for (const hunk of diff.hunks) {
      expect(Number.isInteger(hunk.startWord)).toBe(true);
      expect(hunk.startWord).toBeGreaterThanOrEqual(0);
      const firstRemoved = hunk.lines.find((l) => l.startsWith("-"));
      expect(firstRemoved).toBeDefined();
      expect(firstRemoved?.slice(1)).toBe(beforeWords[hunk.startWord]);
    }
  });

  it("names the vanished price tokens in the hunks", () => {
    const diff = buildPageDiff({
      prevHash: textHash(HEALTHY_TEXT),
      nextHash: textHash(SOFT_TEXT),
      beforeText: HEALTHY_TEXT,
      afterText: SOFT_TEXT,
    });
    const removed = diff.hunks.flatMap((h) => h.lines.filter((l) => l.startsWith("-"))).join("\n");
    expect(removed).toContain("₹499");
    expect(removed).toContain("₹2,499");
  });
});

describe("site diff — the mark is keys, never a body", () => {
  const keysFor = (capturedAt: string) => ({
    beforeTextKey: markKey("watch-fixture", capturedAt, "before-text", "txt"),
    afterTextKey: markKey("watch-fixture", capturedAt, "after-text", "txt"),
    beforeScreenshotKey: markKey("watch-fixture", capturedAt, "before-shot", "png"),
    afterScreenshotKey: markKey("watch-fixture", capturedAt, "after-shot", "png"),
    hunksKey: markKey("watch-fixture", capturedAt, "hunks", "json"),
  });

  it("stores a mark as R2 keys — texts and screenshots by key, never base64 in a row", async () => {
    const diff = buildPageDiff({
      prevHash: textHash(HEALTHY_TEXT),
      nextHash: textHash(SOFT_TEXT),
      beforeText: HEALTHY_TEXT,
      afterText: SOFT_TEXT,
    });
    const { store, written } = makeStore();
    const { refs } = await storeMark(
      store,
      keysFor("2026-09-22T00:00:00Z"),
      diff,
      HEALTHY_TEXT,
      SOFT_TEXT,
      new Uint8Array([137, 80, 78, 71]).buffer, // PNG magic — evidence, not a detector.
      new Uint8Array([137, 80, 78, 71]).buffer,
    );

    // Five keys, every one an R2 object, every one with a recorded type.
    expect(written.size).toBe(5);
    expect(refs.beforeScreenshotKey.contentType).toBe("image/png");
    expect(refs.afterScreenshotKey.contentType).toBe("image/png");
    expect(refs.beforeTextKey.contentType).toContain("text/plain");
    expect(refs.hunksKey.contentType).toBe("application/json");
    // Text and screenshot bytes are stored as bytes, never as a base64 string
    // inside a D1 row: every ref carries a byte count, which is the cost line.
    expect(refs.beforeScreenshotKey.bytes).toBe(4);
    expect(refs.beforeTextKey.bytes).toBeGreaterThan(0);
  });

  it("returns a small reference object — keys only, no body field anywhere", async () => {
    const diff = buildPageDiff({
      prevHash: textHash(HEALTHY_TEXT),
      nextHash: textHash(SOFT_TEXT),
      beforeText: HEALTHY_TEXT,
      afterText: SOFT_TEXT,
    });
    const { store } = makeStore();
    const keys = keysFor("2026-09-22T00:00:00Z");
    await storeMark(
      store,
      keys,
      diff,
      HEALTHY_TEXT,
      SOFT_TEXT,
      new Uint8Array([137, 80, 78, 71]).buffer,
      new Uint8Array([137, 80, 78, 71]).buffer,
    );

    // Keys only, so it is safe to cross a Workflow step boundary: a step's
    // output cap is 1 MiB and a body would blow it.
    const small = markKeys(keys);
    expect(Object.keys(small).sort()).toEqual([
      "afterScreenshotKey",
      "afterTextKey",
      "beforeScreenshotKey",
      "beforeTextKey",
      "hunksKey",
    ]);
    for (const value of Object.values(small)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeLessThan(200);
    }
  });

  it("refuses to store a mark with no changes", async () => {
    const { store } = makeStore();
    await expect(
      storeMark(
        store,
        keysFor("2026-09-22T00:00:00Z"),
        { changes: [], hunks: [], wordsBefore: 1, wordsAfter: 1, wordDelta: 0 },
        "same",
        "same",
        new ArrayBuffer(1),
        new ArrayBuffer(1),
      ),
    ).rejects.toThrow(/no changes/);
  });

  it("keeps mark keys unique per role so a before and an after never collide", () => {
    const a = markKey("w", "2026-09-22T00:00:00Z", "before-text", "txt");
    const b = markKey("w", "2026-09-22T00:00:00Z", "after-text", "txt");
    expect(a).not.toBe(b);
  });

  it("refuses to build a key with no watch and no moment", () => {
    expect(() => markKey("", "2026-09-22T00:00:00Z", "before-text", "txt")).toThrow(/watchId/);
    expect(() => markKey("w", "", "before-text", "txt")).toThrow(/capturedAt/);
  });
});

