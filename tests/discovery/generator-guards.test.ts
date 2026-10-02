import { afterEach, describe, expect, it, vi } from "vitest";

import type { Candidate, FetchedText } from "../../app/lib/discovery/types";
import { assertFetched, logIfEmpty } from "../../app/lib/discovery/types";

const fetched: FetchedText = {
  ok: true,
  status: 200,
  url: "https://example.com/feed",
  contentType: "application/json",
  body: "{}",
};

const candidate: Candidate = { name: "Alphalete", evidence: [] };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertFetched", () => {
  it("throws the generator name and status for a non-ok page", () => {
    expect(() => assertFetched("news", { ...fetched, ok: false, status: 503 })).toThrowError(
      /^news generator fetch failed with status 503$/,
    );
  });

  it("does not throw for an ok page", () => {
    expect(() => assertFetched("news", fetched)).not.toThrow();
  });
});

describe("logIfEmpty", () => {
  it("logs one generator_empty line with the article count for an empty candidate list", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logIfEmpty("news", 7, []);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "discovery.generator_empty", generator: "news", articles: 7 }),
    );
  });

  it("logs nothing when there are candidates", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logIfEmpty("news", 7, [candidate]);

    expect(log).not.toHaveBeenCalled();
  });
});
