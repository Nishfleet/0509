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

const articleCount = 7;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertFetched", () => {
  it("throws the generator name and status for a non-ok page", () => {
    expect(() => assertFetched("news", { ...fetched, ok: false, status: 503 })).toThrowError(
      /^news generator fetch failed with status 503$/,
    );
  });

  it("throws on ok false regardless of a 200 status", () => {
    expect(() => assertFetched("news", { ...fetched, ok: false, status: 200 })).toThrowError(
      /^news generator fetch failed with status 200$/,
    );
  });

  it("does not throw for an ok page", () => {
    expect(() => assertFetched("news", fetched)).not.toThrow();
  });

  it("does not throw for an ok page even with a non-200 status", () => {
    expect(() => assertFetched("news", { ...fetched, ok: true, status: 500 })).not.toThrow();
  });
});

describe("logIfEmpty", () => {
  it("logs one generator_empty line with the article count for an empty candidate list", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logIfEmpty("news", articleCount, []);

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
      event: "discovery.generator_empty",
      generator: "news",
      articles: articleCount,
    });
  });

  it("logs nothing when there are candidates", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logIfEmpty("news", articleCount, [candidate]);

    expect(log).not.toHaveBeenCalled();
  });
});
