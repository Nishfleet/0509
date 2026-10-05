import { describe, expect, it } from "vitest";

import { lintExisting, lintTextAt } from "./eslint-lint-text";

const FEED_STATE_MESSAGE = "Only workers/sources/mentions/youtube.ts may build a YouTube feedState";
const XML_PARSER_MESSAGE = "A second XMLParser is a second feed path";
const FAST_XML_MESSAGE = "A direct fast-xml-parser import is a second parser";

const PROBE = "workers/mentions/map.ts";

const FORGED_STATE = `export const forged = { feedState: "stale", rawBody: "<html></html>" };
`;

const SECOND_PARSER = `import { XMLParser } from "fast-xml-parser";

export const parser = new XMLParser();
`;

async function lintProbe(code: string): Promise<string[]> {
  const result = await lintTextAt(PROBE, code);
  return result.messages;
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
    const messages = await lintExisting("workers/sources/mentions/youtube.ts");
    expect(messages.some((message) => message.includes(FEED_STATE_MESSAGE))).toBe(false);
    expect(messages.some((message) => message.includes(XML_PARSER_MESSAGE))).toBe(false);
  });
});
