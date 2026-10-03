import { describe, expect, it } from "vitest";

import { SOURCE_KINDS, effectiveKindSql } from "../app/lib/source-kind";

describe("SOURCE_KINDS", () => {
  it("lists every source kind in feed order, content last", () => {
    expect(SOURCE_KINDS).toEqual(["ads", "mentions", "site", "hiring", "content"]);
  });
});

describe("effectiveKindSql", () => {
  it("reports a feed source as the content kind and leaves every other platform as its own kind", () => {
    expect(effectiveKindSql("s")).toBe("CASE WHEN s.platform = 'feed' THEN 'content' ELSE s.kind END");
  });

  it("substitutes the alias in both the platform check and the kind column", () => {
    expect(effectiveKindSql("source")).toBe("CASE WHEN source.platform = 'feed' THEN 'content' ELSE source.kind END");
  });
});
