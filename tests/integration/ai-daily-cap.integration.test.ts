import { afterEach, describe, expect, it, vi } from "vitest";

import { AiDailyCapError, takeAiCall } from "../../app/lib/ai/daily-cap.server";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("takeAiCall", () => {
  it("allows calls up to the limit, then refuses and logs the line", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await takeAiCall("proposer", 2);
    await takeAiCall("proposer", 2);

    await expect(takeAiCall("proposer", 2)).rejects.toThrow(AiDailyCapError);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('"event":"ai.daily_cap_reached"'));
  });

  it("counts each line on its own", async () => {
    await takeAiCall("jev", 1);

    await expect(takeAiCall("jev", 1)).rejects.toThrow(AiDailyCapError);
    await expect(takeAiCall("proposer", 5)).resolves.toBeUndefined();
  });
});
