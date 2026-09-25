import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FEED_STATE_MESSAGE = "Only workers/sources/mentions/youtube.ts may build a YouTube feedState";
const XML_PARSER_MESSAGE = "A second XMLParser is a second feed path";
const FAST_XML_MESSAGE = "A direct fast-xml-parser import is a second parser";

const PROBE = "workers/mentions/probe-youtube-feed-tmp.ts";

const FORGED_STATE = `export const forged = { feedState: "stale", rawBody: "<html></html>" };
`;

const SECOND_PARSER = `import { XMLParser } from "fast-xml-parser";

export const parser = new XMLParser();
`;

async function lintProbe(code: string): Promise<string[]> {
  const file = path.join(REPO_ROOT, PROBE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, code);
  try {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const results = await eslint.lintFiles([file]);
    return results.flatMap((result) => result.messages.map((message) => message.message));
  } finally {
    await rm(file, { force: true });
  }
}

describe("youtube feed rules (#4051)", () => {
  it("rejects a feedState literal outside the youtube adapter", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(FORGED_STATE);
    expect(messages.some((message) => message.includes(FEED_STATE_MESSAGE))).toBe(true);
  });

  it("rejects a second XML parser", { timeout: 60_000 }, async () => {
    const messages = await lintProbe(SECOND_PARSER);
    expect(messages.some((message) => message.includes(XML_PARSER_MESSAGE))).toBe(true);
    expect(messages.some((message) => message.includes(FAST_XML_MESSAGE))).toBe(true);
  });

  it("lets the youtube adapter build feedState", { timeout: 60_000 }, async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const results = await eslint.lintFiles([
      path.join(REPO_ROOT, "workers/sources/mentions/youtube.ts"),
    ]);
    const messages = results.flatMap((result) => result.messages.map((message) => message.message));
    expect(messages.some((message) => message.includes(FEED_STATE_MESSAGE))).toBe(false);
    expect(messages.some((message) => message.includes(XML_PARSER_MESSAGE))).toBe(false);
  });
});
