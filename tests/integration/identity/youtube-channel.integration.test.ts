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
});
