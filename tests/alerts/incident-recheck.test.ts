import { describe, expect, it } from "vitest";

import { nextOwnSiteCheck } from "../../app/lib/incident-recheck";

describe("nextOwnSiteCheck (0509#5142)", () => {
  it("gives the next top of the hour from mid-hour", () => {
    expect(nextOwnSiteCheck(new Date("2026-09-25T10:15:00.000Z"))).toBe(
      "2026-09-25T11:00:00.000Z",
    );
  });

  it("moves to the following hour when now is exactly on the hour", () => {
    expect(nextOwnSiteCheck(new Date("2026-09-25T10:00:00.000Z"))).toBe(
      "2026-09-25T11:00:00.000Z",
    );
  });

  it("rolls over midnight into the next UTC day", () => {
    expect(nextOwnSiteCheck(new Date("2026-09-25T23:59:00.000Z"))).toBe(
      "2026-09-26T00:00:00.000Z",
    );
  });

  it("does not mutate the Date it was given", () => {
    const now = new Date("2026-09-25T10:15:00.000Z");

    nextOwnSiteCheck(now);

    expect(now.toISOString()).toBe("2026-09-25T10:15:00.000Z");
  });
});
