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

  it("follows YouTube's consent detour and sends the consent cookie", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        seen.push(`${url} ${new Headers(init.headers).get("cookie") ?? ""}`);
        if (url.startsWith("https://www.youtube.com/@consenthandle0509") && !url.includes("cbrd")) {
          return Promise.resolve(
            new Response(null, { status: 302, headers: { location: "https://consent.youtube.com/m?continue=x" } }),
          );
        }
        if (url.startsWith("https://consent.youtube.com/")) {
          return Promise.resolve(
            new Response(null, {
              status: 303,
              headers: { location: "https://www.youtube.com/@consenthandle0509?cbrd=1&ucbcb=1" },
            }),
          );
        }
        return Promise.resolve(new Response(`"externalId":"${CHANNEL_ID}"`, { status: 200 }));
      }),
    );
    await expect(lookupYoutubeChannel(identityFor("consenthandle0509"))).resolves.toEqual({
      status: "id",
      channelId: CHANNEL_ID,
    });
    expect(seen).toHaveLength(3);
    expect(seen[0]).toContain("SOCS=CAI");
  });

  it("names the last hop when a redirect chain never ends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response(null, { status: 302, headers: { location: "https://www.youtube.com/loop" } })),
      ),
    );
    await expect(lookupYoutubeChannel(identityFor("loophandle0509"))).resolves.toEqual({
      status: "unresolved",
      reason: "more than 5 redirects, last at www.youtube.com/loop",
    });
  });

  it.each([
    ["loopback", "http://127.0.0.1/admin", "loopbackhandle0509"],
    ["the metadata IP", "http://169.254.169.254/latest", "metadatahandle0509"],
    ["an .internal host", "http://metadata.internal/latest", "internalhandle0509"],
  ])("reads a page that redirects to %s as unresolved and never fetches the target", async (_label, target, handle) => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 302, headers: { location: target } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(lookupYoutubeChannel(identityFor(handle))).resolves.toMatchObject({ status: "unresolved" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([["a link labelled otherwise", { platform: "video", url: "https://www.youtube.com/@otherlabel0509" }]])(
    "reads %s to YouTube as unresolved, not as no channel",
    async (_label, social) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(lookupYoutubeChannel(JSON.stringify({ socials: [social] }))).resolves.toEqual({
        status: "unresolved",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a read that found no socials", { socials: [], socialsReadAt: "2026-10-10T21:05:00.000Z" }],
    ["only non-YouTube socials", { socials: [{ platform: "x", url: "https://x.com/brand0509" }] }],
  ])("reads a card with %s as no-url", async (_label, card) => {
    await expect(lookupYoutubeChannel(JSON.stringify(card))).resolves.toEqual({ status: "no-url" });
  });

  it.each([
    ["an http user link", "http://youtube.com/user/Fabletics0509", "https://www.youtube.com/user/Fabletics0509"],
    ["a legacy custom url without a prefix", "https://www.youtube.com/puma0509/", "https://www.youtube.com/puma0509"],
    ["a bare http legacy url", "http://youtube.com/reebok0509", "https://www.youtube.com/reebok0509"],
  ])("reads %s from the youtube page it normalises to", async (_label, href, fetched) => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(`<link rel="canonical" href="https://www.youtube.com/channel/${CHANNEL_ID}">`, { status: 200 }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      lookupYoutubeChannel(JSON.stringify({ socials: [{ platform: "youtube", url: href }] })),
    ).resolves.toEqual({ status: "id", channelId: CHANNEL_ID });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(fetched);
  });

  it.each([
    "https://www.youtube.com/watch?v=abc123",
    "https://www.youtube.com/playlist?list=PL1",
    "https://www.youtube.com/trending",
    "https://www.youtube.com/channel",
    "https://www.youtube.com/signin",
    "https://www.youtube.com/",
  ])("does not read %s as a channel", async (href) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      lookupYoutubeChannel(JSON.stringify({ socials: [{ platform: "youtube", url: href }] })),
    ).resolves.toEqual({ status: "no-url" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says why a youtube page gave no channel id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("consent", { status: 200 }))),
    );
    await expect(lookupYoutubeChannel(identityFor("consentwall0509"))).resolves.toEqual({
      status: "unresolved",
      reason: "youtube page had no channel id (200)",
    });
  });

  it("reads a card whose homepage has not been read yet as unread, so it is not called channel-less", async () => {
    await expect(lookupYoutubeChannel(JSON.stringify({ description: "x" }))).resolves.toEqual({ status: "unread" });
    await expect(lookupYoutubeChannel(JSON.stringify({ socials: [] }))).resolves.toEqual({ status: "unread" });
    await expect(lookupYoutubeChannel(JSON.stringify({ socials: [], socialsReadAt: null }))).resolves.toEqual({
      status: "unread",
    });
  });
});
