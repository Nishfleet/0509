import { describe, expect, it } from "vitest";

import { readTrialRecaps } from "../../app/lib/data/recap.server";

const row = (latest: string | null) => ({
  workspace_id: "ws",
  subscription_id: "sub",
  target_id: "t",
  target_value: "a@0509.io",
  unsubscribe_token: null,
  timezone: "UTC",
  change_count: 1,
  latest,
});

const dbReturning = (results: unknown[]) =>
  ({ prepare: () => ({ bind: () => ({ all: () => Promise.resolve({ results }) }) }) }) as unknown as D1Database;

describe("readTrialRecaps", () => {
  it("skips only the row whose latest move is unreadable", async () => {
    const good = JSON.stringify({ rival: "Acme", what: "Headline changed" });
    const recaps = await readTrialRecaps(
      dbReturning([row('{"rival":null,"what":"x"}'), row("not json"), row(good), row(null)]),
      new Date("2026-10-13T12:00:00.000Z"),
    );

    expect(recaps.map((recap) => recap.latest)).toEqual([{ rival: "Acme", what: "Headline changed" }, null]);
  });
});
