import { captureException } from "@sentry/cloudflare";
import { describe, expect, it, vi } from "vitest";

vi.mock("@sentry/cloudflare", () => ({ captureException: vi.fn() }));

import { reportNightlyResults } from "../workers/nightly-jobs";

describe("reportNightlyResults", () => {
  it("stays quiet when every nightly job fulfilled", () => {
    expect(() =>
      reportNightlyResults([
        { status: "fulfilled", value: undefined },
        { status: "fulfilled", value: 1 },
      ]),
    ).not.toThrow();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports each rejection to Sentry and throws so the monitor is error", () => {
    const first = new Error("standing");
    const second = new Error("cost");

    expect(() =>
      reportNightlyResults([
        { status: "fulfilled", value: undefined },
        { status: "rejected", reason: first },
        { status: "rejected", reason: second },
      ]),
    ).toThrow(AggregateError);

    expect(captureException).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenNthCalledWith(1, first);
    expect(captureException).toHaveBeenNthCalledWith(2, second);
  });

  it("wraps a non-Error rejection so AggregateError still throws", () => {
    vi.mocked(captureException).mockClear();
    expect(() => reportNightlyResults([{ status: "rejected", reason: "standing-failed" }])).toThrow(AggregateError);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error));
  });
});
