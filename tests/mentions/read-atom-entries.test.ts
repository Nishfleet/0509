import { describe, expect, it } from "vitest";

import { readAtomEntries } from "../../workers/sources/mentions/feed";

const TWO_ENTRIES = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<feed xmlns="http://www.w3.org/2005/Atom">',
  "<title>Example</title>",
  "<entry>",
  "<id>urn:uuid:1</id>",
  "<title>First</title>",
  '<link href="https://example.com/a"/>',
  "<updated>2026-09-23T10:00:00Z</updated>",
  "<extra>alpha</extra>",
  "</entry>",
  "<entry>",
  "<id>urn:uuid:2</id>",
  "<title>Second</title>",
  '<link href="https://example.com/b"/>',
  "<updated>2026-09-24T10:00:00Z</updated>",
  "<extra>beta</extra>",
  "</entry>",
  "</feed>",
].join("");

const HTML_PAGE = "<html><head><title>Home</title></head><body><p>Hello</p></body></html>";

const extraFrom = (entryData: Record<string, unknown>) => ({ extra: entryData.extra });

describe("readAtomEntries", () => {
  it("returns two entries and passes getExtraEntryFields output through", () => {
    const entries = readAtomEntries(TWO_ENTRIES, extraFrom);

    expect(entries).toHaveLength(2);
    expect(entries?.map((entry) => entry.title)).toEqual(["First", "Second"]);
    expect(entries?.map((entry) => entry.extra)).toEqual(["alpha", "beta"]);
  });

  it.each([
    ["without a prolog", "<feed></feed>"],
    ["with an xml prolog", '<?xml version="1.0" encoding="UTF-8"?><feed></feed>'],
    ["with a leading BOM", "\uFEFF<feed></feed>"],
    ["with a leading newline", "\n<feed></feed>"],
  ])("returns [] for an empty Atom feed %s", (_label, xml) => {
    expect(readAtomEntries(xml, extraFrom)).toEqual([]);
  });

  it("returns null for an HTML page", () => {
    expect(readAtomEntries(HTML_PAGE, extraFrom)).toBeNull();
  });

  it("returns null for the empty string", () => {
    expect(readAtomEntries("", extraFrom)).toBeNull();
  });

  it("returns null for a malformed XML document", () => {
    expect(readAtomEntries("<feed><entry></feed>", extraFrom)).toBeNull();
  });
});
