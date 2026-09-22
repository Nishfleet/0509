import { describe, expect, it } from "vitest";

import { normaliseInput } from "../../../app/lib/identity/normalise";

// Packet P1 proof table: the four named inputs plus the edge cases.
const CASES: [string, { ok: boolean; kind?: string; registrable?: string | null; platform?: string; handle?: string; url?: string | null }][] = [
  ["gymshark.com", { ok: true, kind: "domain", registrable: "gymshark.com", url: "https://gymshark.com/" }],
  ["https://www.gymshark.com/en-GB/", { ok: true, kind: "domain", registrable: "gymshark.com", url: "https://gymshark.com/" }],
  ["@gymshark", { ok: true, kind: "handle", registrable: null, url: null, handle: "gymshark" }],
  ["https://www.youtube.com/user/GymSharkTV", { ok: true, kind: "channel", registrable: null, platform: "youtube", handle: "gymsharktv" }],
  ["bbc.co.uk", { ok: true, kind: "domain", registrable: "bbc.co.uk", url: "https://bbc.co.uk/" }],
  ["https://bbc.co.uk/news", { ok: true, kind: "domain", registrable: "bbc.co.uk" }],
  ["https://bücher-münchen.de/", { ok: true, kind: "domain", registrable: "xn--bcher-mnchen-dlbg.de" }],
  ["https://www.instagram.com/gymshark/", { ok: true, kind: "handle", platform: "instagram", handle: "gymshark" }],
  ["https://x.com/Gymshark", { ok: true, kind: "handle", platform: "twitter", handle: "gymshark" }],
  ["not a domain at all", { ok: false }],
  ["https://192.168.0.1/", { ok: false }],
];

describe("normaliseInput", () => {
  for (const [input, want] of CASES) {
    it(input, () => {
      const got = normaliseInput(input);
      expect(got.ok).toBe(want.ok);
      if (!want.ok || !got.ok) return;
      if (want.kind) expect(got.subject.kind).toBe(want.kind);
      if (want.registrable !== undefined) expect(got.subject.registrable).toBe(want.registrable);
      if (want.platform) expect(got.subject.platform).toBe(want.platform);
      if (want.handle) expect(got.subject.handle).toBe(want.handle);
      if (want.url !== undefined) expect(got.subject.url).toBe(want.url);
    });
  }
});
