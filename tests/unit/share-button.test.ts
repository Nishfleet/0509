import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sharePicture } from "../../app/components/share-button";

// 0509#6619: "Share my rank" used to log a cancelled share as a failure and,
// on any other native-share rejection, return true so the person got neither a
// share nor the downloaded picture and no message. sharePicture is the boundary
// under test, so it is a named export; the node project has no DOM, so fetch,
// navigator, document and URL.createObjectURL are stubbed to the four cases the
// issue names: resolves, AbortError, another error, and no canShare at all.

// Node has File, Blob, Response and DOMException; document is undefined and
// navigator is a read-only object, so both are stubbed per test.

interface Harness {
  downloads: number;
  links: { href: string; download: string; click: () => void }[];
  revokes: string[];
}

function abortError(): DOMException {
  return new DOMException("share dismissed", "AbortError");
}

function notAllowedError(): DOMException {
  return new DOMException("gesture consumed", "NotAllowedError");
}

// The document stub records the anchor download() creates and counts the
// click(); URL.createObjectURL/revokeObjectURL are real Node so the object-url
// round trip is exercised, with revocations captured through fake timers.
function stubDom(): Harness {
  const harness: Harness = { downloads: 0, links: [], revokes: [] };
  const createdUrls: string[] = [];
  const realCreate = URL.createObjectURL.bind(URL);
  const realRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (object: Blob | MediaSource) => {
    const url = realCreate(object);
    createdUrls.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    harness.revokes.push(url);
    realRevoke(url);
  };
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      const link = {
        href: "",
        download: "",
        click: () => {
          harness.downloads += 1;
        },
      };
      if (tag === "a") harness.links.push(link);
      return link;
    },
  });
  return harness;
}

function okResponse(): Response {
  return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), {
    headers: { "content-type": "image/png" },
  });
}

let harness: Harness;

beforeEach(() => {
  harness = stubDom();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sharePicture", () => {
  it("shares and returns true without downloading when navigator.share resolves", async () => {
    vi.stubGlobal("navigator", {
      canShare: () => true,
      share: vi.fn(() => Promise.resolve()),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(okResponse())),
    );

    const done = await sharePicture();

    expect(done).toBe(true);
    expect(harness.downloads).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns true with no download and no log when the share sheet is dismissed (AbortError)", async () => {
    vi.stubGlobal("navigator", {
      canShare: () => true,
      share: vi.fn(() => Promise.reject(abortError())),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(okResponse())),
    );

    const done = await sharePicture();

    expect(done).toBe(true);
    expect(harness.downloads).toBe(0);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("downloads once and logs once when the native share fails for another reason (NotAllowedError)", async () => {
    vi.stubGlobal("navigator", {
      canShare: () => true,
      share: vi.fn(() => Promise.reject(notAllowedError())),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(okResponse())),
    );

    const done = await sharePicture();

    expect(done).toBe(true);
    expect(harness.downloads).toBe(1);
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = String((console.error as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(logged).toContain("share.native_share_failed");
    expect(logged).not.toContain("five-to-nine-ranking");
  });

  it("downloads without sharing when navigator has no canShare", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(okResponse())),
    );

    const done = await sharePicture();

    expect(done).toBe(true);
    expect(harness.downloads).toBe(1);
    expect(console.error).not.toHaveBeenCalled();
  });
});
