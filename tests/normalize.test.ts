import { describe, expect, it } from "vitest";

import {
  fingerprintSavedQuery,
  normalizeHeadline,
  normalizeSavedQuery,
} from "~/lib/normalize";

describe("normalizeHeadline", () => {
  it("normalizes whitespace and casing without stripping punctuation", () => {
    expect(normalizeHeadline("  50% OFF!   Shop   Now  ")).toEqual({
      raw: "50% OFF!   Shop   Now",
      normalized: "50% off! shop now",
      hash: normalizeHeadline("50% off! shop now").hash,
    });
  });
});

describe("fingerprintSavedQuery", () => {
  it("stays stable regardless of source object key order", () => {
    const first = normalizeSavedQuery("keyword", {
      query: "cod",
      country: "India",
      platform: "Instagram",
      creativeType: "video",
      status: "active",
    });

    const second = normalizeSavedQuery("keyword", {
      status: "active",
      creativeType: "video",
      platform: "Instagram",
      country: "India",
      query: "cod",
    });

    expect(fingerprintSavedQuery(first)).toBe(fingerprintSavedQuery(second));
  });
});
