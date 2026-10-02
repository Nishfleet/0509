import { describe, expect, it } from "vitest";

import {
  YOUTUBE_LINK_MAX,
  YOUTUBE_TOO_LONG_ERROR,
  YOUTUBE_VIDEO_ERROR,
  youtubeLinkRefusal,
} from "../../app/lib/competitor-youtube";

describe("youtubeLinkRefusal", () => {
  it.each([
    "youtube.com/@rivalshop",
    "https://www.youtube.com/@rivalshop",
    "youtube.com/channel/UC123",
    "youtube.com/c/rival",
  ])("lets the channel link %s through", (link) => {
    expect(youtubeLinkRefusal(link)).toBeNull();
  });

  it.each([
    "https://youtu.be/dQw4w9WgXcQ",
    "https://YOUTU.BE/dQw4w9WgXcQ",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "youtube.com/shorts/abc",
    "youtube.com/live/abc",
    "youtube.com/embed/abc",
    "youtube.com/playlist?list=abc",
    "youtube.com/v/abc",
  ])("refuses the video link %s", (link) => {
    expect(youtubeLinkRefusal(link)).toBe(YOUTUBE_VIDEO_ERROR);
  });

  it("refuses a link that is too long before looking at what it points to", () => {
    expect(youtubeLinkRefusal(`youtube.com/@${"a".repeat(YOUTUBE_LINK_MAX)}`)).toBe(YOUTUBE_TOO_LONG_ERROR);
  });

  it("does not call text that is not an address a video", () => {
    expect(youtubeLinkRefusal("not a link at all")).toBeNull();
    expect(youtubeLinkRefusal("")).toBeNull();
  });
});
