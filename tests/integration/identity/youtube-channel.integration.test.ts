import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupYoutubeChannel } from "../../../app/lib/identity/youtube-channel.server";

const CHANNEL_ID = "UCma7hhYJ3bfEhZgw3xl77ww";

function identityFor(handle: string): string {
  return JSON.stringify({ socials: [{ platform: "youtube", url: `https://www.youtube.com/@${handle}` }] });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("lookupYoutubeChannel", () => {
  it("reads the channel id from the handle page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}">`, { status: 200 }),
        ),
      ),
    );
    await expect(lookupYoutubeChannel(identityFor("okhandle0509"))).resolves.toEqual({
      status: "id",
      channelId: CHANNEL_ID,
    });
  });

  it.each([
    ["loopback", "http://127.0.0.1/admin", "loopbackhandle0509"],
    ["the metadata IP", "http://169.254.169.254/latest", "metadatahandle0509"],
    ["an .internal host", "http://metadata.internal/latest", "internalhandle0509"],
  ])("reads a page that redirects to %s as unresolved and never fetches the target", async (_label, target, handle) => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 302, headers: { location: target } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupYoutubeChannel(identityFor(handle))).resolves.toEqual({ status: "unresolved" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an http link", { platform: "youtube", url: "http://www.youtube.com/@plainhttp0509" }],
    ["a link labelled otherwise", { platform: "video", url: "https://www.youtube.com/@otherlabel0509" }],
  ])("reads %s to YouTube as unresolved, not as no channel", async (_label, social) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupYoutubeChannel(JSON.stringify({ socials: [social] }))).resolves.toEqual({
      status: "unresolved",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no socials", {}],
    ["only non-YouTube socials", { socials: [{ platform: "x", url: "https://x.com/brand0509" }] }],
  ])("reads a card with %s as no-url", async (_label, card) => {
    await expect(lookupYoutubeChannel(JSON.stringify(card))).resolves.toEqual({ status: "no-url" });
  });
});
