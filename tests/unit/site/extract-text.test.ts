import { describe, expect, it } from "vitest";

import { extractPageText, hasChanged } from "../../../app/lib/site/extract-text";
import copyAfter from "../../fixtures/copy-change-after.html?raw";
import copyBefore from "../../fixtures/copy-change-before.html?raw";
import gymA from "../../fixtures/gymshark-2026-09-22-a.html?raw";
import gymB from "../../fixtures/gymshark-2026-09-22-b.html?raw";

// Two real captures of https://www.gymshark.com/ on 2026-09-22.
// n1 at 12:20:57Z, n2 at 12:21:00Z. Cache-Control: no-cache, separate connections.
// The 2026-09-21 12:15:40Z byte pair in docs/engines/site-change.md was measured
// and not stored, so these files are a later pair of the same URL.
const GYM_A_SHA = "fabf6f9c868c96fde5b8b15232bf80218543e86637c545790277fc2a49053f54";
const GYM_B_SHA = "439277eb781873ee7476fbdd5dec5d4ca413f00f45e8a2b5d8029d2e120ac9f3";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let hex = "";
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

describe("extractPageText", () => {
  it("drops script, style, noscript and aria-hidden, and collapses whitespace", async () => {
    const extracted = await extractPageText(copyBefore);

    expect(extracted.text).toContain("Summer drop is live");
    expect(extracted.text).toContain("Free shipping over $75");
    expect(extracted.text).toContain("Sale");
    expect(extracted.text).not.toContain("Hidden carousel slide");
    expect(extracted.text).not.toContain("still hidden");
    expect(extracted.text).not.toContain("Enable JavaScript");
    expect(extracted.text).not.toContain("gs-test_web_t127");
    expect(extracted.text).not.toContain("color:red");
    expect(extracted.charCount).toBe(extracted.text.length);
    expect(extracted.hash).toHaveLength(64);
  });

  it("ignores a script-only edit and moves when visible copy changes", async () => {
    const before = copyBefore;
    const after = copyAfter;
    const noise = before.replace("gs-test_web_t127.1", "gs-test_web_t127.0");

    const beforeExtracted = await extractPageText(before);
    const noiseExtracted = await extractPageText(noise);
    const afterExtracted = await extractPageText(after);

    expect(noise).not.toBe(before);
    expect(hasChanged(beforeExtracted.hash, noiseExtracted.hash)).toBe(false);
    expect(hasChanged(beforeExtracted.hash, afterExtracted.hash)).toBe(true);
    expect(afterExtracted.text).toContain("Winter drop is live");
    expect(afterExtracted.text).not.toContain("Summer drop is live");
  });

  it("hashes two real gymshark captures to the same text when the raw bytes differ", async () => {
    const aRaw = await sha256Hex(gymA);
    const bRaw = await sha256Hex(gymB);

    expect(aRaw).toBe(GYM_A_SHA);
    expect(bRaw).toBe(GYM_B_SHA);
    expect(aRaw).not.toBe(bRaw);

    const a = await extractPageText(gymA);
    const b = await extractPageText(gymB);

    expect(a.hash).toBe(b.hash);
    expect(a.charCount).toBe(b.charCount);
    expect(a.charCount).toBeGreaterThan(10_000);
    expect(a.text).toContain("Last Chance Sale");
    expect(hasChanged(a.hash, b.hash)).toBe(false);
  });
});
