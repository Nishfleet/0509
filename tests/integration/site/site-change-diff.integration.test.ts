import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { buildPageDiff, hasChanged } from "../../../app/lib/site/diff";
import { markKey, storeMark, type MarkStore, type R2Ref } from "../../../app/lib/site/marks";
import worker from "../../../workers/fixture-site";

/**
 * Engine 4, P3, the real-change half of the acceptance (0509#4001;
 * docs/engines/site-change.md § PACKETS → P3).
 *
 * "One real competitor change end to end" — driven through the real Worker the
 * repo already owns: 0509-fixture-site (0509#4046), the deliberately breakable
 * site. Its `soft` break removes a priced section from a page that still serves
 * 200, which is precisely the change class the site-change engine exists to
 * catch: a section disappeared and a fetch alone would not notice.
 *
 * This runs in the `workers` project — real workerd, real KV — because the
 * fixture Worker needs `SubtleCrypto.timingSafeEqual`, which the node runtime
 * does not expose. The pure-logic suite in `tests/unit/site/diff.test.ts` runs
 * the same pair of texts through the same functions, so the two together are
 * the end-to-end and the unit halves of one proof.
 *
 * What is deliberately absent, and why: the layout and the screenshot pair are
 * stubbed, not rendered. Browser Rendering is not reachable from CI (probe 6 in
 * docs/engines/site-change.md — both host tokens lack the scope), and the
 * screenshot pair is evidence, not the detector, so faking it here would prove
 * nothing about correctness. The screenshot leg is exercised against the same
 * key-writing surface the real escalation uses, with PNG magic bytes recorded
 * as bytes: the mark stores keys, never base64.
 */

/**
 * The normalisation P1 owns, written against the platform primitive
 * docs/REBUILD-STACK.md §5.1 mandates: `HTMLRewriter` drops `script`, `style`,
 * `noscript` and `aria-hidden` subtrees by construction, so a regex cannot
 * disagree with it about the fixture's markup. The production extractor uses
 * the same four drops plus whitespace collapse; P1's own proof (two committed
 * real fixtures) belongs to P1's packet, not here.
 */
const extractVisibleText = async (html: string): Promise<string> => {
  const chunks: string[] = [];
  await new HTMLRewriter()
    .on("script, style, noscript, [aria-hidden='true']", {
      element(element) {
        element.remove();
      },
    })
    .on("body", {
      text(text) {
        chunks.push(text.text);
      },
    })
    .transform(new Response(html))
    .text();
  return chunks.join(" ").replace(/\s+/g, " ").trim();
};

/** Stable hash of the extracted text — P1 uses SHA-256; any deterministic map works here. */
const textHash = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};

/** A recorder standing in for the R2 binding: proves keys, types and byte counts. */
const makeStore = (): { store: MarkStore; written: Map<string, R2Ref["contentType"]> } => {
  const written = new Map<string, R2Ref["contentType"]>();
  const store: MarkStore = {
    async put(key, _value, options) {
      written.set(key, options?.httpMetadata?.contentType ?? "application/octet-stream");
      return undefined;
    },
  };
  return { store, written };
};

const getHome = () =>
  worker.fetch(new Request("https://fixture.0509.in/"), env, createExecutionContext());

const flip = async (mode: "off" | "soft") => {
  const ctx = createExecutionContext();
  await worker.fetch(
    new Request(`https://fixture.0509.in/__break?mode=${mode}`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.FIXTURE_SITE_TOKEN}` },
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
};

describe("engine 4 P3 — a real change, end to end", () => {
  beforeEach(async () => {
    // KV backs every test in this file, so a leak would make the suite
    // order-dependent. Start healthy: the unchanged-tick case only holds
    // otherwise.
    await flip("off");
  });

  it("an unchanged tick writes one snapshot row and nothing else", async () => {
    const first = await extractVisibleText(await (await getHome()).text());
    const second = await extractVisibleText(await (await getHome()).text());

    // Two ticks, one page, no change: the hashes match, so the gate never fires
    // and the whole P3 layer below the gate is never reached. One snapshot row
    // is the sweep's job (P5); what P3 guarantees is that none of its own work
    // happens.
    expect(textHash(first)).toBe(textHash(second));
    expect(hasChanged(textHash(first), textHash(second))).toBe(false);

    // The unchanged tick's consequence, asserted so it can fail: the R2
    // recorder is asked to store a mark built from the pair, the gate refuses,
    // and the recorder stays empty. A gate that fired would write five keys.
    const { store, written } = makeStore();
    expect(() =>
      buildPageDiff({
        prevHash: textHash(first),
        nextHash: textHash(second),
        beforeText: first,
        afterText: second,
      }),
    ).toThrow(/hash gate has not fired/);
    await expect(
      storeMark(
        store,
        {
          beforeTextKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "before-text", "txt"),
          afterTextKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "after-text", "txt"),
          beforeScreenshotKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "before-shot", "png"),
          afterScreenshotKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "after-shot", "png"),
          hunksKey: markKey("watch-fixture", "2026-09-22T00:00:00Z", "hunks", "json"),
        },
        { changes: [], hunks: [], wordsBefore: 1, wordsAfter: 1, wordDelta: 0 },
        first,
        second,
        new ArrayBuffer(1),
        new ArrayBuffer(1),
      ),
    ).rejects.toThrow(/no changes/);
    expect(written.size).toBe(0);
  });

  it("a real change: the priced section disappears, and the diff names it", async () => {
    const beforeHtml = await (await getHome()).text();
    const beforeText = await extractVisibleText(beforeHtml);
    const prevHash = textHash(beforeText);

    await flip("soft");

    const afterRes = await getHome();
    // The status is the trap, not the proof: the soft break is a 200.
    expect(afterRes.status).toBe(200);
    const afterText = await extractVisibleText(await afterRes.text());
    const nextHash = textHash(afterText);

    // The change is real and the gate sees it: a 200 whose priced section is gone.
    expect(beforeText).toContain("₹499");
    expect(afterText).not.toContain("₹499");
    expect(hasChanged(prevHash, nextHash)).toBe(true);

    const diff = buildPageDiff({
      prevHash,
      nextHash,
      beforeText,
      afterText,
    });

    // The hunks name the vanished tokens, which is the evidence the judgment
    // layer reads — no Jev call has any ground truth to guess at.
    const removed = diff.hunks
      .flatMap((h) => h.lines.filter((l) => l.startsWith("-")))
      .join("\n");
    expect(removed).toContain("₹499");
    expect(removed).toContain("₹2,499");

    const beforeWords = beforeText.split(" ");
    for (const hunk of diff.hunks) {
      // The position is a real before-text word index, and the word it names is
      // the one the hunk's own first `-` line removes.
      const firstRemoved = hunk.lines.find((l) => l.startsWith("-"));
      expect(firstRemoved).toBeDefined();
      expect(beforeWords[hunk.startWord]).toBe(firstRemoved?.slice(1));
    }
    // The whole section went, so the word delta is substantial and negative.
    expect(diff.wordDelta).toBeLessThan(-10);
  });

  it("the repaired page reads as unchanged again — a real repair closes the round-trip", async () => {
    const healthy = await extractVisibleText(await (await getHome()).text());
    await flip("soft");
    const broken = await extractVisibleText(await (await getHome()).text());
    await flip("off");
    const repaired = await extractVisibleText(await (await getHome()).text());

    expect(textHash(repaired)).toBe(textHash(healthy));
    expect(hasChanged(textHash(broken), textHash(repaired))).toBe(true);
    expect(hasChanged(textHash(healthy), textHash(repaired))).toBe(false);
  });

  it("the mark is written as R2 keys — bytes as bytes, never base64 in a row", async () => {
    const beforeText = await extractVisibleText(await (await getHome()).text());
    await flip("soft");
    const afterText = await extractVisibleText(await (await getHome()).text());
    const diff = buildPageDiff({
      prevHash: textHash(beforeText),
      nextHash: textHash(afterText),
      beforeText,
      afterText,
    });

    // The stored hunk names the page position of the vanished section in words,
    // not lines: extracted text is one line, so a line position would be zero on
    // every hunk and could not say where on the page anything changed.
    for (const hunk of diff.hunks) {
      const firstRemoved = hunk.lines.find((l) => l.startsWith("-"));
      expect(firstRemoved).toBeDefined();
      expect(beforeText.split(" ")[hunk.startWord]).toBe(firstRemoved?.slice(1));
    }

    const capturedAt = "2026-09-22T00:00:00Z";
    const { store, written } = makeStore();
    const { refs } = await storeMark(
      store,
      {
        beforeTextKey: markKey("watch-fixture", capturedAt, "before-text", "txt"),
        afterTextKey: markKey("watch-fixture", capturedAt, "after-text", "txt"),
        beforeScreenshotKey: markKey("watch-fixture", capturedAt, "before-shot", "png"),
        afterScreenshotKey: markKey("watch-fixture", capturedAt, "after-shot", "png"),
        hunksKey: markKey("watch-fixture", capturedAt, "hunks", "json"),
      },
      diff,
      beforeText,
      afterText,
      new Uint8Array([137, 80, 78, 71]).buffer, // PNG magic, one byte of evidence.
      new Uint8Array([137, 80, 78, 71]).buffer,
    );

    // Five R2 objects, one per role, with recorded types.
    expect(written.size).toBe(5);
    expect(refs.beforeScreenshotKey.contentType).toBe("image/png");
    expect(refs.afterScreenshotKey.contentType).toBe("image/png");
    expect(refs.beforeTextKey.contentType).toContain("text/plain");
    expect(refs.hunksKey.contentType).toContain("application/json");
    // Keys are what D1 and the step output carry; nothing else escapes.
    for (const ref of Object.values(refs)) {
      expect(typeof ref.key).toBe("string");
      expect(ref.key).toMatch(/^marks\/watch-fixture\//);
      expect(ref.bytes).toBeGreaterThan(0);
    }
  });
});
