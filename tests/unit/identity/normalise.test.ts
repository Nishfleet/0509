import { describe, expect, it } from "vitest";

import { normaliseSubject, type NormaliseResult } from "../../../app/lib/identity/normalise";

const domain = (registrable: string, url: string): NormaliseResult => ({
  ok: true,
  subject: { kind: "domain", registrable, url },
});

const handle = (
  registrable: string,
  url: string | null,
  platform?: "instagram" | "tiktok" | "x",
): NormaliseResult => ({
  ok: true,
  subject: platform
    ? { kind: "handle", registrable, url, platform }
    : { kind: "handle", registrable, url },
});

const channel = (registrable: string, url: string): NormaliseResult => ({
  ok: true,
  subject: { kind: "channel", platform: "youtube", registrable, url },
});

const fail = (reason: "empty" | "unparseable" | "no-registrable-domain" | "unsupported-platform"): NormaliseResult => ({
  ok: false,
  reason,
});

describe("normaliseSubject", () => {
  it.each<[string, NormaliseResult]>([
    ["gymshark.com", domain("gymshark.com", "https://gymshark.com/")],
    ["https://www.gymshark.com/en-GB/", domain("gymshark.com", "https://www.gymshark.com/")],
    ["  GymShark.com  ", domain("gymshark.com", "https://gymshark.com/")],
    ["@gymshark", handle("gymshark", null)],
    ["https://www.youtube.com/user/GymSharkTV", channel("gymsharktv", "https://www.youtube.com/user/GymSharkTV")],
    ["https://www.youtube.com/@MrBeast", channel("mrbeast", "https://www.youtube.com/@MrBeast")],
    [
      "https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA",
      channel("UCX6OQ3DkcsbYNE6H8uQQuVA", "https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA"),
    ],
    ["https://www.instagram.com/gymshark/", handle("gymshark", "https://www.instagram.com/gymshark/", "instagram")],
    ["https://www.tiktok.com/@gymshark", handle("gymshark", "https://www.tiktok.com/@gymshark", "tiktok")],
    ["https://twitter.com/Gymshark", handle("gymshark", "https://x.com/gymshark", "x")],
    ["bbc.co.uk", domain("bbc.co.uk", "https://bbc.co.uk/")],
    ["https://news.bbc.co.uk/sport", domain("bbc.co.uk", "https://news.bbc.co.uk/")],
    ["münchen.de", domain("xn--mnchen-3ya.de", "https://xn--mnchen-3ya.de/")],
    ["", fail("empty")],
    ["@", fail("unparseable")],
    ["ftp://gymshark.com", fail("unparseable")],
    ["localhost", fail("no-registrable-domain")],
    ["https://www.youtube.com/", fail("unsupported-platform")],
  ])("normaliseSubject(%j)", (input, expected) => {
    expect(normaliseSubject(input)).toEqual(expected);
  });
});
