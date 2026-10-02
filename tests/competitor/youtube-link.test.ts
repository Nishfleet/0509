import { describe, expect, it } from "vitest";

import {
  YOUTUBE_LINK_MAX,
  YOUTUBE_TOO_LONG_ERROR,
  YOUTUBE_VIDEO_ERROR,
  youtubeLinkRefusal,
} from "../../app/lib/competitor-youtube";

function channelOfLength(length: number): string {
  return `youtube.com/@${"a".repeat(length - "youtube.com/@".length)}`;
}

describe("youtubeLinkRefusal", () => {
  it("refuses a link one character past the cap", () => {
    expect(youtubeLinkRefusal(channelOfLength(YOUTUBE_LINK_MAX + 1))).toBe(YOUTUBE_TOO_LONG_ERROR);
  });

  it("lets a channel link of exactly the cap length through", () => {
    expect(channelOfLength(YOUTUBE_LINK_MAX)).toHaveLength(YOUTUBE_LINK_MAX);
    expect(youtubeLinkRefusal(channelOfLength(YOUTUBE_LINK_MAX))).toBeNull();
  });

  it.each([
    "https://youtu.be/abc",
    "youtube.com/watch?v=abc",
    "https://www.youtube.com/shorts/abc",
    "youtube.com/live/abc",
    "youtube.com/embed/abc",
    "youtube.com/playlist?list=abc",
    "youtube.com/v/abc",
    "YOUTU.BE/abc",
  ])("refuses the video link %s", (link) => {
    expect(youtubeLinkRefusal(link)).toBe(YOUTUBE_VIDEO_ERROR);
  });

  it("reads a scheme-less channel link as a channel", () => {
    expect(youtubeLinkRefusal("youtube.com/@brand")).toBeNull();
  });

  it("reads a scheme-less watch link as a video", () => {
    expect(youtubeLinkRefusal("youtube.com/watch?v=1")).toBe(YOUTUBE_VIDEO_ERROR);
  });

  it.each([
    "https://www.youtube.com/@brand",
    "youtube.com/channel/UC123",
    "youtube.com/c/brand",
    "youtube.com/watching",
  ])("lets the channel link %s through", (link) => {
    expect(youtubeLinkRefusal(link)).toBeNull();
  });

  it("lets text that is not an address at all through", () => {
    expect(youtubeLinkRefusal("not a url at all")).toBeNull();
  });
});
