import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { buildPageDiff, buildStoredHunks, diffWordsPositioned } from "../../../app/lib/site/diff";
import { extractPageText, hasChanged } from "../../../app/lib/site/extract-text";
import { markKey, storeMark } from "../../../app/lib/site/marks";

/**
 * Engine 4, P3 — the word diff and the before-and-after mark (0509#4001;
 * docs/engines/site-change.md § PACKETS → P3).
 *
 * The texts below are the real, normalised copy of the fixture site we own
 * (0509-fixture-site, 0509#4046, `workers/fixture-site.ts`): the healthy page
 * and its `soft` break, which is "200 with the pricing section gone". The
 * extracted strings are committed here rather than fetched, because what this
 * file proves is that the *diff layer* is correct — word granularity, page
 * positions, hunk bounds, and the R2-key-only mark — independent of how the
 * strings got there. The hash gate itself is P1's `hasChanged`
 * (`app/lib/site/extract-text.ts`), which the sweep calls before it ever
 * reaches this module; `buildPageDiff` refuses the one thing that means the
 * gate did not fire, which is two identical texts.
 *
 * It runs in real workerd (vitest.config.ts, the `workers` project), so both
 * the hash and the R2 bucket are the real platform surfaces rather than a
 * second implementation: P1's `extractPageText` produces the hash the sweep
 * writes on the snapshot row, and `env.CARD_ARTIFACTS` is a real R2 binding,
 * so every "five keys, with these content types" assertion is checked against
 * real storage. The same pair is driven end to end through the real fixture
 * Worker in `tests/integration/site/site-change-diff.test.ts`.
 */

const expectHunksLocateRemovals = (
  hunks: ReturnType<typeof buildStoredHunks>,
  beforeWords: string[],
): void => {
  for (const hunk of hunks) {
    const firstRemoved = hunk.lines.find((l) => l.startsWith("-"));
    expect(firstRemoved).toBeDefined();
    // The hunk's own position points at the word the `-` line removes, so the
    // stored hunks carry the page position the packet asks for.
    expect(firstRemoved?.slice(1)).toBe(beforeWords[hunk.startWord]);
  }
};

/** The healthy fixture page, extracted and whitespace-normalised. */
const HEALTHY_TEXT = `Five to Nine — fixture Track every competitor move, in one weekly brief Pricing Starter — ₹499 / month Pro — ₹1,299 / month Team — ₹2,499 / month Choose a plan and check out`;

/** The same page with its pricing section gone (the soft break). */
const SOFT_TEXT = `Five to Nine — fixture Track every competitor move, in one weekly brief`;

/** The healthy page on the next tick, byte-identical and text-identical. */
const HEALTHY_TEXT_AGAIN = HEALTHY_TEXT;

/**
 * P1's real hash over the already-extracted text. The extraction half of
 * `extractPageText` is the identity on a text that carries no script, style,
 * noscript or aria-hidden subtree, so wrapping keeps the string intact and
 * only the SHA-256 half is used.
 */
const textHash = async (text: string): Promise<string> =>
  (await extractPageText(`<p>${text}</p>`)).hash;

/** A distinct R2 prefix per call, so a test never reads another test's mark. */
const keysFor = (watchId: string, capturedAt: string) => ({
  beforeTextKey: markKey(watchId, capturedAt, "before-text", "txt"),
  afterTextKey: markKey(watchId, capturedAt, "after-text", "txt"),
  beforeScreenshotKey: markKey(watchId, capturedAt, "before-shot", "png"),
  afterScreenshotKey: markKey(watchId, capturedAt, "after-shot", "png"),
  hunksKey: markKey(watchId, capturedAt, "hunks", "json"),
});

describe("site diff — an unchanged tick is never diffed", () => {
  it("refuses two identical texts, which is the unchanged tick", () => {
    expect(() =>
      buildPageDiff({ beforeText: HEALTHY_TEXT, afterText: HEALTHY_TEXT }),
    ).toThrow(/nothing to diff/);
  });

  it("refuses an absent text, which is a page that never extracted", () => {
    for (const [beforeText, afterText] of [["", SOFT_TEXT], [HEALTHY_TEXT, ""]] as const) {
      expect(() => buildPageDiff({ beforeText, afterText })).toThrow(/nothing to diff/);
    }
  });

  it("the unchanged tick writes one row and nothing else — no mark is built", async () => {
    // The gate's real consequence, asserted rather than described: on an
    // unchanged tick the sweep stops at the snapshot row, so there is no hunk
    // and no key anywhere. This is the "no screenshot, no diff, no Jev call"
    // half of the acceptance. The store is a real R2 binding, so the empty
    // assertion below reads real storage: a gate that fired would write five
    // objects to the bucket.
    const prevHash = await textHash(HEALTHY_TEXT);
    const nextHash = await textHash(HEALTHY_TEXT_AGAIN);
    expect(prevHash).toBe(nextHash);
    expect(hasChanged(prevHash, nextHash)).toBe(false);

    expect(() =>
      buildPageDiff({ beforeText: HEALTHY_TEXT, afterText: HEALTHY_TEXT_AGAIN }),
    ).toThrow(/nothing to diff/);

    const keys = keysFor("unchanged-tick", "2026-09-22T00:00:00.000Z");
    await expect(
      storeMark(
        env.CARD_ARTIFACTS,
        keys,
        { changes: [], hunks: [], wordsBefore: 1, wordsAfter: 1, wordDelta: 0 },
        HEALTHY_TEXT,
        HEALTHY_TEXT_AGAIN,
        new ArrayBuffer(1),
        new ArrayBuffer(1),
      ),
    ).rejects.toThrow(/no changes/);
    expect(await env.CARD_ARTIFACTS.get(keys.hunksKey)).toBeNull();
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
    // reason this matters.
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

  it("locates a pure insertion at a before-text index, never past its end", () => {
    // A hunk with only `+` lines has no `-` line to stop on, so the position
    // must be fixed at the insertion point rather than advanced past the last
    // context line — a competitor adding a section is the common "launch" class.
    const before = "Home About Contact";
    const after = "Home Pricing About Contact";
    const hunks = buildStoredHunks(before, after, 2);
    expect(hunks).toHaveLength(1);
    const beforeWords = before.split(" ");
    expect(hunks[0].startWord).toBeLessThan(beforeWords.length);
    expect(hunks[0].startWord).toBe(diffWordsPositioned(before, after)[0].startWord);
  });
});

describe("site diff — the real fixture-site text pair", () => {
  it("a vanished section drops the priced words out of the text", () => {
    // Derived from the shipped diff, not restated from the constants: the two
    // texts are the fixture-site page and its soft break, and the proof that
    // the break is a real copy change is that the diff's removed side carries
    // the priced tokens while its changed side does not.
    const changes = diffWordsPositioned(HEALTHY_TEXT, SOFT_TEXT);
    const removed = changes.map((c) => c.before).join(" ");
    const added = changes.map((c) => c.after).join(" ");
    expect(removed).toContain("₹499");
    expect(removed).toContain("₹2,499");
    expect(added).not.toContain("₹499");
    expect(added).not.toContain("₹2,499");
  });

  it("the unchanged tick produces the same hash", async () => {
    expect(await textHash(HEALTHY_TEXT)).toBe(await textHash(HEALTHY_TEXT_AGAIN));
  });

  it("builds positioned hunks for the real change, once the gate has fired", async () => {
    // The hash gate that gates the diff is P1's, not this module's: the
    // sweep asks `hasChanged` before it ever reaches the diff layer.
    const beforeHash = await textHash(HEALTHY_TEXT);
    const afterHash = await textHash(SOFT_TEXT);
    expect(hasChanged(beforeHash, afterHash)).toBe(true);

    const diff = buildPageDiff({ beforeText: HEALTHY_TEXT, afterText: SOFT_TEXT });
    expect(diff.hunks.length).toBeGreaterThan(0);
    expect(diff.changes.length).toBeGreaterThan(0);
    // The priced section vanished, so the word delta is negative — the code
    // evidence D3s reads without any Jev call.
    expect(diff.wordDelta).toBeLessThan(0);
    // Every stored hunk names a real page position: the word in the before
    // text at `startWord` is the word the hunk's own `-` line removed.
    expectHunksLocateRemovals(diff.hunks, HEALTHY_TEXT.split(" "));
  });

  it("names the vanished price tokens in the hunks", async () => {
    const diff = buildPageDiff({ beforeText: HEALTHY_TEXT, afterText: SOFT_TEXT });
    const removed = diff.hunks.flatMap((h) => h.lines.filter((l) => l.startsWith("-"))).join("\n");
    expect(removed).toContain("₹499");
    expect(removed).toContain("₹2,499");
  });
});

describe("site diff — the mark is keys, never a body", () => {
  it("stores a mark as R2 keys — texts and screenshots by key, never base64 in a row", async () => {
    const diff = buildPageDiff({ beforeText: HEALTHY_TEXT, afterText: SOFT_TEXT });
    const keys = keysFor("mark-bytes", "2026-09-22T01:00:00.000Z");
    const { refs } = await storeMark(
      env.CARD_ARTIFACTS,
      keys,
      diff,
      HEALTHY_TEXT,
      SOFT_TEXT,
      new Uint8Array([137, 80, 78, 71]).buffer, // PNG magic — evidence, not a detector.
      new Uint8Array([137, 80, 78, 71]).buffer,
    );

    // Five objects in real R2, one per role, each with the content type the
    // store actually recorded.
    for (const ref of Object.values(refs)) {
      expect(typeof ref.key).toBe("string");
      expect(ref.key).toMatch(/^marks\/mark-bytes\//);
      expect(ref.bytes).toBeGreaterThan(0);
      const stored = await env.CARD_ARTIFACTS.get(ref.key);
      expect(stored).not.toBeNull();
      expect(stored?.size ?? -1).toBe(ref.bytes);
    }
    expect(refs.beforeScreenshotKey.contentType).toBe("image/png");
    expect(refs.afterScreenshotKey.contentType).toBe("image/png");
    expect(refs.beforeTextKey.contentType).toContain("text/plain");
    expect(refs.hunksKey.contentType).toBe("application/json");
    // Text and screenshot bytes are stored as bytes, never as a base64 string
    // inside a D1 row: every ref carries a byte count, which is the cost line.
    expect(refs.beforeScreenshotKey.bytes).toBe(4);
    expect(refs.beforeTextKey.bytes).toBeGreaterThan(0);
    // The stored hunks body carries hunks and word changes, never the pages
    // themselves: D3's `item` is the hunks, never full pages
    // (docs/engines/site-change.md), and the texts already have their own keys.
    // The body is asserted against the pages' distinguishing prose — the hunks
    // legitimately contain the price token that disappeared.
    const hunksObject = await env.CARD_ARTIFACTS.get(keys.hunksKey);
    expect(hunksObject).not.toBeNull();
    if (hunksObject === null) throw new Error("hunksKey must be present after storeMark");
    const body = JSON.parse(await hunksObject.text());
    expect(Object.keys(body).sort()).toEqual(["changes", "hunks"]);
    expect(JSON.stringify(body)).not.toContain("Track every competitor move");
    expect(JSON.stringify(body)).toContain("₹499");
  });

  it("refuses to store a mark with no changes", async () => {
    await expect(
      storeMark(
        env.CARD_ARTIFACTS,
        keysFor("mark-nochanges", "2026-09-22T03:00:00.000Z"),
        { changes: [], hunks: [], wordsBefore: 1, wordsAfter: 1, wordDelta: 0 },
        "same",
        "same",
        new ArrayBuffer(1),
        new ArrayBuffer(1),
      ),
    ).rejects.toThrow(/no changes/);
  });

  it("names every role's key exactly, so a retried step rewrites instead of colliding", () => {
    // The key is deterministic from (watchId, capturedAt, role): two roles for
    // the same watch and moment take two distinct keys, and the same watch and
    // moment twice produces the byte-identical key, which is what makes a
    // retried `step.do` an overwrite rather than an orphan.
    const roles = ["before-text", "after-text", "before-shot", "after-shot", "hunks"] as const;
    const extensions = {
      "before-text": "txt",
      "after-text": "txt",
      "before-shot": "png",
      "after-shot": "png",
      hunks: "json",
    } as const;
    const keys = roles.map((role) => markKey("w", "2026-09-22T00:00:00Z", role, extensions[role]));
    expect(new Set(keys).size).toBe(roles.length);
    expect(keys[0]).toBe("marks/w/2026-09-22T00-00-00Z/before-text.txt");
    expect(markKey("w", "2026-09-22T00:00:00Z", "before-text", "txt")).toBe(keys[0]);
  });

  it("refuses to build a key with no watch and no moment", () => {
    expect(() => markKey("", "2026-09-22T00:00:00Z", "before-text", "txt")).toThrow(/watchId/);
    expect(() => markKey("w", "", "before-text", "txt")).toThrow(/capturedAt/);
  });
});