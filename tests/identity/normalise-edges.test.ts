import { describe, expect, it } from "vitest";

import { isLoginWall, normaliseSubject } from "../../app/lib/identity/normalise";

describe("normaliseSubject edges", () => {
  it("keeps the case of a /channel/ id, unlike /user/ and /c/", () => {
    const result = normaliseSubject("https://www.youtube.com/channel/UCabc123");

    expect(result).toEqual({
      ok: true,
      subject: {
        kind: "channel",
        platform: "youtube",
        registrable: "UCabc123",
        url: "https://www.youtube.com/channel/UCabc123",
      },
    });
  });

  it("refuses a bare social host with no handle as an unsupported platform", () => {
    expect(normaliseSubject("https://x.com")).toEqual({ ok: false, reason: "unsupported-platform" });
    expect(normaliseSubject("https://instagram.com/")).toEqual({ ok: false, reason: "unsupported-platform" });
  });

  it("refuses input that is not a URL at all", () => {
    expect(normaliseSubject("a b")).toEqual({ ok: false, reason: "unparseable" });
  });
});

describe("isLoginWall edges", () => {
  it("is not a login wall when the input cannot be parsed as a URL", () => {
    expect(isLoginWall("a b")).toBe(false);
  });

  it("is not a login wall on a non-http scheme, whatever the path", () => {
    expect(isLoginWall("ftp://example.com/login")).toBe(false);
  });

  it("is a login wall on an http login path", () => {
    expect(isLoginWall("https://example.com/login")).toBe(true);
  });
});
