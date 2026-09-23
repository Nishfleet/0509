import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

import { buildPageDiff } from "../../../app/lib/site/diff";
import { extractPageText, hasChanged } from "../../../app/lib/site/extract-text";
import { markKey, storeMark } from "../../../app/lib/site/marks";
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
 * Real workerd against a real local KV and a real local R2 bucket, the same
 * binding kinds production has, so a real-key assertion would be the one that
 * can fail. The R2 bucket binding `MARKS` is declared on
 * tests/integration/wrangler.fixture-site.test.jsonc; the bucket is real workerd
 * storage, not a recorder.
 *
 * What is deliberately absent, and why: the screenshot pair is stubbed by PNG
 * magic bytes. Browser Rendering is not reachable from CI (probe 6 in
 * docs/engines/site-change.md — both host tokens lack the scope), and the
 * screenshot pair is evidence, not the detector, so faking it here would prove
 * nothing about correctness. The screenshot leg is exercised against the same
 * `storeMark` surface the real escalation uses, with PNG magic bytes recorded
 * as bytes: the mark stores keys, never base64.
 */

const CAPTURED_AT = "2026-09-22T00:00:00.000Z";

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

const baseKeys = () => ({
  beforeTextKey: markKey("watch-fixture", CAPTURED_AT, "before-text", "txt"),
  afterTextKey: markKey("watch-fixture", CAPTURED_AT, "after-text", "txt"),
  beforeScreenshotKey: markKey("watch-fixture", CAPTURED_AT, "before-shot", "png"),
  afterScreenshotKey: markKey("watch-fixture", CAPTURED_AT, "after-shot", "png"),
  hunksKey: markKey("watch-fixture", CAPTURED_AT, "hunks", "json"),
});

const expectHunksLocateRemovals = (
  hunks: ReturnType<typeof buildPageDiff>["hunks"],
  beforeWords: string[],
): void => {
  for (const hunk of hunks) {
    const firstRemoved = hunk.lines.find((l) => l.startsWith("-"));
    expect(firstRemoved).toBeDefined();
    // The hunk's own position points at the word its `-` line removed.
    expect(beforeWords[hunk.startWord]).toBe(firstRemoved?.slice(1));
  }
};

describe("engine 4 P3 — a real change, end to end", () => {
  beforeEach(async () => {
    await flip("off");
  });

  it("an unchanged tick writes one snapshot row and nothing else", async () => {
    const first = await extractPageText(await (await getHome()).text());
    const second = await extractPageText(await (await getHome()).text());

    expect(first.hash).toBe(second.hash);

    // P3 refuses to build a mark when there is nothing to diff against. The
    // gate's real consequence is asserted so it can fail: a gate that fired
    // would write five keys to the bucket.
    expect(hasChanged(first.hash, second.hash)).toBe(false);
    expect(() =>
      buildPageDiff({ beforeText: first.text, afterText: second.text }),
    ).toThrow(/nothing to diff/);

    await expect(
      storeMark(
        env.MARKS,
        baseKeys(),
        { changes: [], hunks: [], wordsBefore: 1, wordsAfter: 1, wordDelta: 0 },
        first.text,
        second.text,
        new ArrayBuffer(1),
        new ArrayBuffer(1),
      ),
    ).rejects.toThrow(/no changes/);

    const probe = env.MARKS.get(baseKeys().hunksKey);
    expect(await probe).toBeNull();
  });

  it("a real change: the priced section disappears, and the diff names it", async () => {
    const beforeHtml = await (await getHome()).text();
    const before = await extractPageText(beforeHtml);

    await flip("soft");

    const afterRes = await getHome();
    expect(afterRes.status).toBe(200);
    const after = await extractPageText(await afterRes.text());

    expect(before.text).toContain("₹499");
    expect(after.text).not.toContain("₹499");
    expect(before.hash).not.toBe(after.hash);

    expect(hasChanged(before.hash, after.hash)).toBe(true);
    const diff = buildPageDiff({ beforeText: before.text, afterText: after.text });

    const removed = diff.hunks
      .flatMap((h) => h.lines.filter((l) => l.startsWith("-")))
      .join("\n");
    expect(removed).toContain("₹499");
    expect(removed).toContain("₹2,499");

    expectHunksLocateRemovals(diff.hunks, before.text.split(" "));
    expect(diff.wordDelta).toBeLessThan(-10);
  });

  it("the repaired page reads as unchanged again — a real repair closes the round-trip", async () => {
    const healthy = await extractPageText(await (await getHome()).text());
    await flip("soft");
    const broken = await extractPageText(await (await getHome()).text());
    await flip("off");
    const repaired = await extractPageText(await (await getHome()).text());

    expect(repaired.hash).toBe(healthy.hash);
    expect(broken.hash).not.toBe(repaired.hash);
    // A healthy page reaches the gate with two identical hashes: no diff.
    expect(hasChanged(healthy.hash, repaired.hash)).toBe(false);
    expect(() =>
      buildPageDiff({ beforeText: healthy.text, afterText: repaired.text }),
    ).toThrow(/nothing to diff/);
  });

  it("the mark is written as R2 keys — bytes as bytes, never base64 in a row", async () => {
    const before = await extractPageText(await (await getHome()).text());
    await flip("soft");
    const after = await extractPageText(await (await getHome()).text());
    expect(hasChanged(before.hash, after.hash)).toBe(true);
    const diff = buildPageDiff({ beforeText: before.text, afterText: after.text });

    expectHunksLocateRemovals(diff.hunks, before.text.split(" "));

    const keys = baseKeys();
    const { refs } = await storeMark(
      env.MARKS,
      keys,
      diff,
      before.text,
      after.text,
      new Uint8Array([137, 80, 78, 71]).buffer,
      new Uint8Array([137, 80, 78, 71]).buffer,
    );

    // Five R2 objects in the bucket, one per role. The keys are exact, so the
    // acceptance's "the R2 keys for both texts and both screenshots" is a
    // reproducible assertion rather than a claim about a run.
    expect(refs).toEqual({
      beforeTextKey: {
        key: "marks/watch-fixture/2026-09-22T00-00-00-000Z/before-text.txt",
        bytes: expect.any(Number),
        contentType: "text/plain; charset=utf-8",
      },
      afterTextKey: {
        key: "marks/watch-fixture/2026-09-22T00-00-00-000Z/after-text.txt",
        bytes: expect.any(Number),
        contentType: "text/plain; charset=utf-8",
      },
      beforeScreenshotKey: {
        key: "marks/watch-fixture/2026-09-22T00-00-00-000Z/before-shot.png",
        bytes: 4,
        contentType: "image/png",
      },
      afterScreenshotKey: {
        key: "marks/watch-fixture/2026-09-22T00-00-00-000Z/after-shot.png",
        bytes: 4,
        contentType: "image/png",
      },
      hunksKey: {
        key: "marks/watch-fixture/2026-09-22T00-00-00-000Z/hunks.json",
        bytes: expect.any(Number),
        contentType: "application/json",
      },
    });
    for (const ref of Object.values(refs)) {
      expect(ref.bytes).toBeGreaterThan(0);
    }

    const stored = await env.MARKS.get(keys.hunksKey);
    expect(stored).not.toBeNull();
    if (stored === null) throw new Error("hunksKey must be present after storeMark");
    const body = JSON.parse(await stored.text());
    expect(Object.keys(body).sort()).toEqual(["changes", "hunks"]);
    expect(JSON.stringify(body)).not.toContain("Track every competitor move");
    expect(JSON.stringify(body)).toContain("₹499");

    for (const key of [keys.beforeTextKey, keys.afterTextKey]) {
      const obj = await env.MARKS.get(key);
      expect(obj).not.toBeNull();
      const contentType = obj?.httpMetadata?.contentType ?? "";
      expect(contentType).toContain("text/plain");
    }
    for (const key of [keys.beforeScreenshotKey, keys.afterScreenshotKey]) {
      const obj = await env.MARKS.get(key);
      expect(obj).not.toBeNull();
      expect(obj?.httpMetadata?.contentType).toBe("image/png");
    }
  });
});