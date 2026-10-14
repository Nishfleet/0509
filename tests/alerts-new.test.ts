import { describe, expect, it } from "vitest";

import { newSinceBriefLine } from "../app/lib/alerts-new";

const END = "2026-10-12T04:00:00.000Z";

describe("newSinceBriefLine", () => {
  it("counts the alerts that arrived after the last brief's week", () => {
    expect(
      newSinceBriefLine(["2026-10-13T08:00:00.000Z", "2026-10-12T05:00:00.000Z", "2026-10-10T08:00:00.000Z"], END),
    ).toBe("2 new since your last brief.");
  });

  it("says nothing when nothing is newer", () => {
    expect(newSinceBriefLine(["2026-10-10T08:00:00.000Z"], END)).toBeNull();
  });

  it("says nothing before the first brief or with an unreadable date", () => {
    expect(newSinceBriefLine(["2026-10-13T08:00:00.000Z"], undefined)).toBeNull();
    expect(newSinceBriefLine(["2026-10-13T08:00:00.000Z"], "soon")).toBeNull();
  });
});
