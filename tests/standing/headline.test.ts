import { describe, expect, it } from "vitest";

import { readLatestRankedWeek } from "../../app/lib/data/standing.server";
import { greetingFor, headlineFrom } from "../../app/lib/standing-headline";

describe("headlineFrom", () => {
  it("reports rank 2 of 2 when self is second", () => {
    expect(
      headlineFrom([
        { role: "competitor", rank: 1 },
        { role: "self", rank: 2 },
      ]),
    ).toEqual({ rank: 2, of: 2 });
  });

  it("reports rank 1 of 6 when self is first", () => {
    const rows = [
      { role: "self", rank: 1 },
      { role: "competitor", rank: 2 },
      { role: "competitor", rank: 3 },
      { role: "competitor", rank: 4 },
      { role: "competitor", rank: 5 },
      { role: "competitor", rank: 6 },
    ];
    expect(headlineFrom(rows)).toEqual({ rank: 1, of: 6 });
  });

  it("returns null for a single self row", () => {
    expect(headlineFrom([{ role: "self", rank: 1 }])).toBe(null);
  });

  it("returns null when no row is the self brand", () => {
    expect(
      headlineFrom([
        { role: "competitor", rank: 1 },
        { role: "competitor", rank: 2 },
        { role: "competitor", rank: 3 },
      ]),
    ).toBe(null);
  });
});

describe("greetingFor", () => {
  it("greets 07:00 UTC in the morning", () => {
    expect(greetingFor(new Date("2026-09-24T07:00:00Z"), "UTC")).toBe("Good morning.");
  });

  it("greets 00:00 in Los Angeles in the morning", () => {
    expect(greetingFor(new Date("2026-09-24T07:00:00Z"), "America/Los_Angeles")).toBe(
      "Good morning.",
    );
  });

  it("greets 13:00 UTC in the afternoon", () => {
    expect(greetingFor(new Date("2026-09-24T13:00:00Z"), "UTC")).toBe("Good afternoon.");
  });

  it("greets 19:00 UTC in the evening", () => {
    expect(greetingFor(new Date("2026-09-24T19:00:00Z"), "UTC")).toBe("Good evening.");
  });
});

describe("readLatestRankedWeek", () => {
  it("maps one snake_case row to the camelCase shape", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: () =>
            Promise.resolve({
              results: [
                {
                  entity_id: "e1",
                  name: "Casetta",
                  role: "self",
                  rank: 2,
                  movement: -1,
                  week_start_at: "2026-09-21T07:00:00.000Z",
                },
              ],
            }),
        }),
      }),
    } as unknown as D1Database;
    await expect(readLatestRankedWeek(db, "ws1")).resolves.toEqual([
      {
        entityId: "e1",
        name: "Casetta",
        role: "self",
        rank: 2,
        movement: -1,
        weekStartAt: "2026-09-21T07:00:00.000Z",
      },
    ]);
  });
});
