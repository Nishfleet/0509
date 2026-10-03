import { describe, expect, it } from "vitest";

import { ListingError, parseListing } from "../../../app/lib/hiring/listing";

const BOARD = "https://boards.example.com/rival";

describe("parseListing, unexpected shapes", () => {
  it("throws ListingError when Ashby has no jobs", () => {
    expect(() => parseListing("ashby", JSON.stringify({}), BOARD)).toThrow(
      "ashby: unexpected listing shape",
    );
  });

  it("throws ListingError when Workable jobs is not an array", () => {
    expect(() => parseListing("workable", JSON.stringify({ jobs: "nope" }), BOARD)).toThrow(
      "workable: unexpected listing shape",
    );
  });

  it("throws ListingError when Lever receives an object instead of an array", () => {
    expect(() => parseListing("lever", JSON.stringify({ jobs: [] }), BOARD)).toThrow(
      "lever: unexpected listing shape",
    );
  });

  it("is a ListingError for a bad shape", () => {
    let caught: unknown;
    try {
      parseListing("ashby", JSON.stringify({}), BOARD);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ListingError);
  });

  it("throws ListingError when the body is not JSON", () => {
    expect(() => parseListing("ashby", "not json", BOARD)).toThrow("ashby: body is not JSON");
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
