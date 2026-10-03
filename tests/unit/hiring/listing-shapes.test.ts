import { describe, expect, it } from "vitest";

import { ListingError, parseListing } from "../../../app/lib/hiring/listing";

const BOARD = "https://boards.example.com/rival";

describe("parseListing, unexpected shapes", () => {
  it("throws ListingError when Ashby has no jobs key", () => {
    const bad = () => parseListing("ashby", JSON.stringify({}), BOARD);
    expect(bad).toThrow(ListingError);
    expect(bad).toThrow("ashby: unexpected listing shape");
  });

  it("throws ListingError when Workable jobs is not an array", () => {
    const bad = () => parseListing("workable", JSON.stringify({ jobs: "nope" }), BOARD);
    expect(bad).toThrow(ListingError);
    expect(bad).toThrow("workable: unexpected listing shape");
  });

  it("throws ListingError when Lever receives an object instead of an array", () => {
    const bad = () => parseListing("lever", JSON.stringify({ jobs: [] }), BOARD);
    expect(bad).toThrow(ListingError);
    expect(bad).toThrow("lever: unexpected listing shape");
  });

  it("throws ListingError when the body is not JSON", () => {
    const bad = () => parseListing("ashby", "not json", BOARD);
    expect(bad).toThrow(ListingError);
    expect(bad).toThrow("ashby: body is not JSON");
  });

  it("returns no roles for a well-shaped board with zero jobs", () => {
    for (const platform of ["greenhouse", "ashby", "workable"] as const) {
      expect(parseListing(platform, JSON.stringify({ jobs: [] }), BOARD)).toEqual([]);
    }
    expect(parseListing("lever", "[]", BOARD)).toEqual([]);
  });

  it("drops a Greenhouse row that fails its schema and keeps the rest", () => {
    const roles = parseListing(
      "greenhouse",
      JSON.stringify({
        jobs: [
          { id: { nested: true }, title: "Bad" },
          { id: 7, title: "Good" },
        ],
      }),
      BOARD,
    );

    expect(roles).toHaveLength(1);
    expect(roles[0]?.id).toBe("7");
  });
});
