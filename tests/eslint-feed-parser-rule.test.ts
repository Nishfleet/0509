import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

const PROBE = "app/lib/feeds/parse-feed.ts";

async function lintProbe(code: string): Promise<{ ignored: boolean; messages: string[] }> {
  return lintTextAt(PROBE, code);
}

const TAG_SCAN_MESSAGE = "Looking a feed tag up by name is a hand-rolled parser";
const TAG_READER_MESSAGE = "A tag-reading helper is a hand-rolled parser";

const TAG_LOOKUP = `export function readItems(xml: string): number {
  return xml.indexOf("item");
}
`;

const TAG_READER = `export function readBlock(xml: string): string {
  return unwrapCdata(stripTags(xml));
}
function unwrapCdata(text: string): string {
  return text;
}
function stripTags(text: string): string {
  return text;
}
`;

const MAPPER = `import { extractFromXml } from "@extractus/feed-extractor";
export function parse(xml: string): number {
  return extractFromXml(xml).entries?.length ?? 0;
}
`;

describe("eslint hand-rolled feed parser rule (#7000)", () => {
  it("rejects a feed tag name looked up as a literal", { timeout: 60_000 }, async () => {
    const result = await lintProbe(TAG_LOOKUP);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(TAG_SCAN_MESSAGE))).toBe(true);
  });

  it("rejects unwrapCdata and stripTags in the feed module", { timeout: 60_000 }, async () => {
    const result = await lintProbe(TAG_READER);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(TAG_READER_MESSAGE))).toBe(true);
  });

  it("allows a mapper over extractFromXml", { timeout: 60_000 }, async () => {
    const result = await lintProbe(MAPPER);
    expect(result.messages.some((m) => m.includes(TAG_SCAN_MESSAGE) || m.includes(TAG_READER_MESSAGE))).toBe(false);
  });

  it("leaves parse-feed.ts and discover-feed.ts unblocked", { timeout: 60_000 }, async () => {
    const parseMessages = await lintExisting("app/lib/feeds/parse-feed.ts");
    const discoverMessages = await lintExisting("app/lib/feeds/discover-feed.ts");
    expect(parseMessages.some((m) => m.includes(TAG_SCAN_MESSAGE) || m.includes(TAG_READER_MESSAGE))).toBe(false);
    expect(discoverMessages.some((m) => m.includes(TAG_SCAN_MESSAGE) || m.includes(TAG_READER_MESSAGE))).toBe(false);
  });
});
