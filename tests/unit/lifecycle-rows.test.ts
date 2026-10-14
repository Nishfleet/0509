import { describe, expect, it } from "vitest";

import { readMonthlies } from "../../app/lib/data/monthly.server";
import { readWinbacks } from "../../app/lib/data/winback.server";

const dbReturning = (results: unknown[]) =>
  ({ prepare: () => ({ bind: () => ({ all: () => Promise.resolve({ results }) }) }) }) as unknown as D1Database;

const base = {
  workspace_id: "ws",
  subscription_id: "sub",
  target_id: "t",
  target_value: "a@0509.io",
  unsubscribe_token: null,
  change_count: 1,
};

describe("lifecycle readers", () => {
  it("win-back skips only the row whose latest move is unreadable", async () => {
    const rows = [
      { ...base, last_seen_at: "2026-09-01T00:00:00Z", latest: '{"rival":null,"what":"x"}' },
      { ...base, last_seen_at: "2026-09-01T00:00:00Z", latest: "not json" },
      { ...base, last_seen_at: "2026-09-01T00:00:00Z", latest: null },
    ];

    const winbacks = await readWinbacks(dbReturning(rows), new Date("2026-10-13T12:00:00.000Z"));

    expect(winbacks.map((winback) => winback.latest)).toEqual([null]);
  });

  it("monthly skips only the row whose moves are unreadable", async () => {
    const rows = [
      { ...base, moves: '[{"rival":null,"what":"x"}]' },
      { ...base, moves: "not json" },
      { ...base, moves: '[{"rival":"Acme","what":"Headline changed"}]' },
    ];

    const monthlies = await readMonthlies(dbReturning(rows), new Date("2026-10-05T12:00:00.000Z"));

    expect(monthlies.map((monthly) => monthly.moves)).toEqual([[{ rival: "Acme", what: "Headline changed" }]]);
  });
});
