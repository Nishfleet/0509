import { describe, expect, it } from "vitest";

import { gdeltSeendateToIso } from "../../app/lib/discovery/gdelt";

describe("gdeltSeendateToIso", () => {
  it("rewrites a valid GDELT seendate to ISO 8601", () => {
    expect(gdeltSeendateToIso("20261002T134500Z")).toBe("2026-10-02T13:45:00Z");
  });

  it("returns null for null", () => {
    expect(gdeltSeendateToIso(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(gdeltSeendateToIso(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(gdeltSeendateToIso("")).toBeNull();
  });

  it("returns null when the trailing Z is missing", () => {
    expect(gdeltSeendateToIso("20261002T134500")).toBeNull();
  });

  it("returns null when the date is dash-separated", () => {
    expect(gdeltSeendateToIso("2026-10-02T13:45:00Z")).toBeNull();
  });

  it("returns null when there is trailing text", () => {
    expect(gdeltSeendateToIso("20261002T134500Z extra")).toBeNull();
  });
});
