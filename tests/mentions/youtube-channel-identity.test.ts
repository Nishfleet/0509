import { describe, expect, it } from "vitest";

import { identityHasYoutubeUrl, isYoutubeChannelId } from "../../app/lib/mentions/youtube-channel";

const CHANNEL_ID = "UCma7hhYJ3bfEhZgw3xl77ww";
const YOUTUBE_CHANNEL_URL = `https://www.youtube.com/channel/${CHANNEL_ID}`;

function identityJson(value: unknown): string {
  return JSON.stringify(value);
}

describe("isYoutubeChannelId", () => {
  it("accepts a well-formed UC channel id", () => {
    expect(isYoutubeChannelId(CHANNEL_ID)).toBe(true);
  });

  it("accepts an id whose tail uses the full allowed character set", () => {
    expect(isYoutubeChannelId(`UC${"aA0_-".repeat(3)}abcdefg`)).toBe(true);
  });

  it("rejects an id one character short", () => {
    expect(isYoutubeChannelId(CHANNEL_ID.slice(0, -1))).toBe(false);
  });

  it("rejects an id one character long", () => {
    expect(isYoutubeChannelId(`${CHANNEL_ID}x`)).toBe(false);
  });

  it("rejects a well-formed id carrying a character the pattern does not allow", () => {
    expect(isYoutubeChannelId(`UC${CHANNEL_ID.slice(2, -1)}!`)).toBe(false);
  });

  it("rejects a lowercase-prefixed id", () => {
    expect(isYoutubeChannelId(`uc${CHANNEL_ID.slice(2)}`)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isYoutubeChannelId("")).toBe(false);
  });
});

describe("identityHasYoutubeUrl", () => {
  it("is true when socials include a youtube.com channel url", () => {
    const raw = identityJson({ socials: [{ platform: "youtube", url: YOUTUBE_CHANNEL_URL }] });

    expect(identityHasYoutubeUrl(raw)).toBe(true);
  });

  it("is true when the youtube social is not the first entry", () => {
    const raw = identityJson({
      socials: [
        { platform: "x", url: "https://x.com/somebody" },
        { platform: "youtube", url: YOUTUBE_CHANNEL_URL },
      ],
    });

    expect(identityHasYoutubeUrl(raw)).toBe(true);
  });

  it("is true for a youtube handle url, which normalises to the same platform", () => {
    const raw = identityJson({ socials: [{ platform: "youtube", url: "https://www.youtube.com/@someone" }] });

    expect(identityHasYoutubeUrl(raw)).toBe(true);
  });

  it("is false for a youtube-declared social whose url is not a youtube url", () => {
    const raw = identityJson({ socials: [{ platform: "youtube", url: "https://example.com/somebody" }] });

    expect(identityHasYoutubeUrl(raw)).toBe(false);
  });

  it("is false when socials hold only another platform", () => {
    const raw = identityJson({ socials: [{ platform: "instagram", url: "https://www.instagram.com/somebody" }] });

    expect(identityHasYoutubeUrl(raw)).toBe(false);
  });

  it("is false when socials is absent", () => {
    expect(identityHasYoutubeUrl(identityJson({}))).toBe(false);
    expect(identityHasYoutubeUrl(identityJson({ socials: [] }))).toBe(false);
  });

  it("throws for non-JSON input", () => {
    expect(() => identityHasYoutubeUrl("not-json")).toThrow();
  });

  it("throws for a socials entry that is not a string url", () => {
    const raw = identityJson({ socials: [{ platform: "youtube", url: 7 }] });

    expect(() => identityHasYoutubeUrl(raw)).toThrow();
  });
});
