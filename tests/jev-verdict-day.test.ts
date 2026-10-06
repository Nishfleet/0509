import { describe, expect, it, vi } from "vitest";

import { countVerdictsOnDay } from "../app/lib/data/jev_verdict.server";

function dbRecording(): { db: D1Database; bind: ReturnType<typeof vi.fn> } {
  const bind = vi.fn(() => ({ first: () => Promise.resolve({ n: 4 }) }));
  return {
    db: { prepare: () => ({ bind }) } as unknown as D1Database,
    bind,
  };
}

describe("countVerdictsOnDay", () => {
  it("counts rows between the UTC day bounds", async () => {
    const { db, bind } = dbRecording();
    await expect(countVerdictsOnDay(db, "2026-09-22")).resolves.toBe(4);
    expect(bind).toHaveBeenCalledWith("2026-09-22T00:00:00.000Z", "2026-09-23T00:00:00.000Z");
  });

  it("rejects a day that is not YYYY-MM-DD before it touches D1", async () => {
    const { db, bind } = dbRecording();
    await expect(countVerdictsOnDay(db, "not-a-day")).rejects.toThrow("countVerdictsOnDay: day is not YYYY-MM-DD");
    expect(bind).not.toHaveBeenCalled();
  });
});
