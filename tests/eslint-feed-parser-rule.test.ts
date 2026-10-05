import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const TAG_SCAN_MESSAGE = "Looking a feed tag up by name is a hand-rolled parser";
const TAG_READER_MESSAGE = "A tag-reading helper is a hand-rolled parser";
const TAG_STRIP_MESSAGE = "Stripping tags with /<[^>]*>/ is the incomplete sanitizer";

const TAG_LOOKUP = `export function readItems(xml: string): number {
  return xml.indexOf("item");
}
`;

const TAG_READER = `export function readBlock(xml: string): string {
  return unwrapCdata(unmarkup(stripTags(xml)));
}
function unwrapCdata(text: string): string {
  return text;
}
function unmarkup(text: string): string {
  return text;
}
function stripTags(text: string): string {
  return text;
}
`;

const TAG_STRIP = `export function readTitle(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}
`;

const MAPPER = `import { extractFromXml } from "@extractus/feed-extractor";
export function parse(xml: string): number {
  return extractFromXml(xml).entries?.length ?? 0;
}
`;

async function lintProbe(rel: string, code: string): Promise<{ ignored: boolean; messages: string[] }> {
  const file = path.join(REPO_ROOT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    if (await eslint.isPathIgnored(file)) {
      return { ignored: true, messages: [] };
    }
    const results = await eslint.lintFiles([file]);
    return {
      ignored: false,
      messages: results.flatMap((result) => result.messages.map((m) => m.message)),
    };
  } finally {
    await rm(file, { force: true });
  }
}

async function lintExisting(rel: string): Promise<string[]> {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const results = await eslint.lintFiles([path.join(REPO_ROOT, rel)]);
  return results.flatMap((result) => result.messages.map((m) => m.message));
}

describe("eslint hand-rolled feed parser rule (#7000)", () => {
  it("rejects a feed tag name looked up as a literal", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/feeds/probe-hand-rolled-tmp.ts", TAG_LOOKUP);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(TAG_SCAN_MESSAGE))).toBe(true);
  });

  it("rejects unwrapCdata, unmarkup and stripTags in the feed module", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/feeds/probe-hand-rolled-tmp.ts", TAG_READER);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(TAG_READER_MESSAGE))).toBe(true);
  });

  it("rejects a tag-strip regex in the feed module", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/feeds/probe-hand-rolled-tmp.ts", TAG_STRIP);
    expect(result.ignored).toBe(false);
    expect(result.messages.some((m) => m.includes(TAG_STRIP_MESSAGE))).toBe(true);
  });

  it("allows a mapper over extractFromXml", { timeout: 60_000 }, async () => {
    const result = await lintProbe("app/lib/feeds/probe-hand-rolled-tmp.ts", MAPPER);
    expect(result.messages.some((m) => m.includes(TAG_SCAN_MESSAGE) || m.includes(TAG_READER_MESSAGE))).toBe(false);
  });

  it("leaves parse-feed.ts and discover-feed.ts unblocked", { timeout: 60_000 }, async () => {
    const parseMessages = await lintExisting("app/lib/feeds/parse-feed.ts");
    const discoverMessages = await lintExisting("app/lib/feeds/discover-feed.ts");
    expect(parseMessages.some((m) => m.includes(TAG_SCAN_MESSAGE) || m.includes(TAG_READER_MESSAGE))).toBe(false);
    expect(discoverMessages.some((m) => m.includes(TAG_SCAN_MESSAGE) || m.includes(TAG_READER_MESSAGE))).toBe(false);
  });
});
