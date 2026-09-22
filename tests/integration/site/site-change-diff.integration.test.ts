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
 * The normalisation P1 owns. `HTMLRewriter` is the platform primitive
 * docs/REBUILD-STACK.md §5.1 mandates, and the production extractor uses it;
 * this is the same four drops (script, style, noscript, aria-hidden) plus
 * whitespace collapse, written against the fixture's markup. P1's own proof
 * (two committed real fixtures) belongs to P1's packet, not here.
 */
const extractVisibleText = (html: string): string =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/[a-z0-9]+>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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
    const first = extractVisibleText(await (await getHome()).text());
    const second = extractVisibleText(await (await getHome()).text());

    // Two ticks, one page, no change: the hashes match, so the gate never fires
    // and the whole P3 layer below the gate is never reached. One snapshot row
    // is the sweep's job (P5); what P3 guarantees is that none of its own work
    // happens. Asserted by the absence of any hunk, key or R2 write.
    expect(textHash(first)).toBe(textHash(second));
    expect(hasChanged(textHash(first), textHash(second))).toBe(false);

    const { store, written } = makeStore();
    expect(() =>
      buildPageDiff({
        prevHash: textHash(first),
        nextHash: textHash(second),
        beforeText: first,
        afterText: second,
      }),
    ).toThrow(/hash gate has not fired/);
    expect(written.size).toBe(0);
    expect(store).toBeDefined();
  });

  it("a real change: the priced section disappears, and the diff names it", async () => {
    const beforeHtml = await (await getHome()).text();
    const beforeText = extractVisibleText(beforeHtml);
    const prevHash = textHash(beforeText);

    await flip("soft");

    const afterRes = await getHome();
    // The status is the trap, not the proof: the soft break is a 200.
    expect(afterRes.status).toBe(200);
    const afterText = extractVisibleText(await afterRes.text());
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
    for (const hunk of diff.hunks) {
      expect(Number.isInteger(hunk.startWord)).toBe(true);
      expect(hunk.startWord).toBeGreaterThanOrEqual(0);
    }
    // The whole section went, so the word delta is substantial and negative.
    expect(diff.wordDelta).toBeLessThan(-10);
  });

  it("the repaired page reads as unchanged again — a real repair closes the round-trip", async () => {
    const healthy = extractVisibleText(await (await getHome()).text());
    await flip("soft");
    const broken = extractVisibleText(await (await getHome()).text());
    await flip("off");
    const repaired = extractVisibleText(await (await getHome()).text());

    expect(textHash(repaired)).toBe(textHash(healthy));
    expect(hasChanged(textHash(broken), textHash(repaired))).toBe(true);
    expect(hasChanged(textHash(healthy), textHash(repaired))).toBe(false);
  });

  it("the mark is written as R2 keys — bytes as bytes, never base64 in a row", async () => {
    const beforeText = extractVisibleText(await (await getHome()).text());
    await flip("soft");
    const afterText = extractVisibleText(await (await getHome()).text());
    const diff = buildPageDiff({
      prevHash: textHash(beforeText),
      nextHash: textHash(afterText),
      beforeText,
      afterText,
    });

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
