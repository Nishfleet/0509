import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { extractMagicLink, InboxReadError, readRawMessage, staleLinks, waitForMagicLink } from "../e2e/inbox";

// J1's link extraction, pinned in a merge gate so a mail-format change fails
// here rather than as a 120s production poll timeout (0509#3927). The app
// sends multipart/alternative (text and HTML); parts may be quoted-printable
// or base64, and an HTML href escapes `&` as `&amp;` (0509#4355).

const EXPECTED = "https://0509.io/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp";
const PLAIN = [
  "Sign in to Five to Nine:",
  "",
  "https://0509.io/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp",
].join("\n");

const QUOTED_PRINTABLE = [
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "https://0509.io/api/auth/magic-link/verify?token=3Dabc123&callbackURL=3D%2Fapp",
].join("\r\n");

const SOFT_WRAPPED = [
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "https://0509.io/api/auth/magic-link/verify?token=3Dabc123verylongtoken=\r\npart2&callbackURL=3D%2Fapp",
].join("\r\n");

const PLAIN_WITH_EQUALS = [
  "Sign in to Five to Nine:",
  "",
  "https://0509.io/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp",
].join("\n");

function base64Part(body: string): string {
  return btoa(body).replace(/(.{76})/g, "$1\r\n");
}

const MULTIPART_QP = [
  "Content-Type: multipart/alternative; boundary=bound4355",
  "",
  "--bound4355",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "https://0509.io/api/auth/magic-link/verify?token=3Dabc123&callbackURL=3D%2Fapp",
  "--bound4355",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  '<a href=3D"https://0509.io/api/auth/magic-link/verify?token=3Dabc123&amp;callbackURL=3D%2Fapp">Sign in</a>',
  "--bound4355--",
  "",
].join("\r\n");

const MULTIPART_BASE64 = [
  "Content-Type: multipart/alternative; boundary=bound4355",
  "",
  "--bound4355",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  base64Part("https://0509.io/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp"),
  "--bound4355",
  "Content-Type: text/html; charset=utf-8",
  "Content-Transfer-Encoding: base64",
  "",
  base64Part(
    '<a href="https://0509.io/api/auth/magic-link/verify?token=abc123&amp;callbackURL=%2Fapp">Sign in</a>',
  ),
  "--bound4355--",
  "",
].join("\r\n");

const HTML_ONLY = [
  "Content-Type: text/html; charset=utf-8",
  "",
  '<a href="https://0509.io/api/auth/magic-link/verify?token=abc123&amp;callbackURL=%2Fapp">Sign in</a>',
].join("\r\n");

describe("extractMagicLink", () => {
  // extractMagicLink reads the ambient lane (e2e/inbox.ts), so these 0509.io
  // fixtures hold only with no lane set: pin it rather than depend on the
  // shell that started the suite.
  beforeEach(() => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("finds the verify URL in a plain body", () => {
    expect(extractMagicLink(PLAIN)).toBe(EXPECTED);
  });

  it("decodes =3D inside the query before matching", () => {
    expect(extractMagicLink(QUOTED_PRINTABLE)).toBe(
      "https://0509.io/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp",
    );
  });

  it("joins a soft-wrapped URL", () => {
    expect(extractMagicLink(SOFT_WRAPPED)).toBe(
      "https://0509.io/api/auth/magic-link/verify?token=abc123verylongtokenpart2&callbackURL=%2Fapp",
    );
  });

  it("leaves a literal = alone when the message is not quoted-printable", () => {
    expect(extractMagicLink(PLAIN_WITH_EQUALS)).toBe(
      "https://0509.io/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp",
    );
  });

  it("returns null when the message carries no verify link", () => {
    expect(extractMagicLink("Subject: hello\n\nno link here")).toBeNull();
  });

  it("reads the HTML href out of a multipart/alternative message", () => {
    expect(extractMagicLink(MULTIPART_QP)).toBe(EXPECTED);
  });

  it("decodes base64 parts in a multipart/alternative message", () => {
    expect(extractMagicLink(MULTIPART_BASE64)).toBe(EXPECTED);
  });

  it("unescapes &amp; in an HTML-only href", () => {
    expect(extractMagicLink(HTML_ONLY)).toBe(EXPECTED);
  });
});

// The link is only the one this run asked for. The preview lane's Worker
// mails on its own origin, so the extractor takes the base URL the browser is
// driving and a 0509.io link read there is a link this run never sent.
const PREVIEW_ORIGIN = "https://mq-1-0509-preview.example.workers.dev";
const PREVIEW_EXPECTED = `${PREVIEW_ORIGIN}/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp`;
const PREVIEW_PLAIN = ["Sign in to Five to Nine:", "", PREVIEW_EXPECTED].join("\n");

describe("on a preview lane", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("takes the verify URL the Preview mailed on its own origin", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", PREVIEW_ORIGIN);
    expect(extractMagicLink(PREVIEW_PLAIN)).toBe(PREVIEW_EXPECTED);
  });

  it("refuses a link on another origin", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", PREVIEW_ORIGIN);
    expect(extractMagicLink(PLAIN)).toBeNull();
  });

  it("reads the origin off a base URL that carries a path or a trailing slash", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", `${PREVIEW_ORIGIN}/app/`);
    expect(extractMagicLink(PREVIEW_PLAIN)).toBe(PREVIEW_EXPECTED);
  });

  // Actions sets an unset workflow env var to "", not to an absent one, and
  // new URL("") throws: an empty base URL has to fall back like an absent one.
  it("takes production's origin when the base URL is empty", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "");
    expect(extractMagicLink(PLAIN)).toBe(EXPECTED);
  });

  // The poll's catch swallows everything, so an unusable base URL has to name
  // itself before the poll starts rather than surface as a 120s no-mail timeout.
  // The fetch stub is not what makes these pass — laneOrigin() throws first. It
  // keeps a regression off the network: without the guard, this would reach the
  // production inbox Worker for real.
  it("names an unparseable base URL instead of timing out", async () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "not-a-url");
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(PLAIN, { status: 200 })));
    // The extractor itself is the path staleLinks takes on a 200 body.
    expect(() => extractMagicLink(PLAIN)).toThrow(
      "PLAYWRIGHT_TEST_BASE_URL is not an http(s) URL: not-a-url",
    );
    await expect(waitForMagicLink("e2e+stale@0509.io", "token")).rejects.toThrow(
      "PLAYWRIGHT_TEST_BASE_URL is not an http(s) URL: not-a-url",
    );
  });

  // A scheme-less value parses (origin "null"), so it would key the extractor
  // on "null" and end in the same silent timeout; only http(s) is a lane.
  it("names a base URL that parses but is not http(s)", async () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "localhost:8787");
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(PLAIN, { status: 200 })));
    await expect(waitForMagicLink("e2e+stale@0509.io", "token")).rejects.toThrow(
      "PLAYWRIGHT_TEST_BASE_URL is not an http(s) URL: localhost:8787",
    );
  });
});

// The pre-send read on the sign-in path (0509#5839) must tell a missing
// message (404) from the inbox failing, so a 500 is never read as "nothing
// stored".
describe("readRawMessage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("carries a non-200 answer as InboxReadError with its status", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 500 })));
    const failure = readRawMessage("e2e+stale@0509.io", "token");
    await expect(failure).rejects.toBeInstanceOf(InboxReadError);
    await expect(failure).rejects.toMatchObject({ status: 500 });
    await expect(failure).rejects.toThrow("inbox answered HTTP 500 for e2e+stale@0509.io");
  });

  it("carries 403 the same way, status included", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 403 })));
    await expect(readRawMessage("e2e+stale@0509.io", "token")).rejects.toMatchObject({ status: 403 });
  });

  it("carries 404 so a caller can tell it from a failure", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
    await expect(readRawMessage("e2e+stale@0509.io", "token")).rejects.toMatchObject({ status: 404 });
  });
});

// The pre-send read on the sign-in path (0509#5839): a fixed fixture address
// still holds the previous run's spent link, so staleLinks is what the wait
// skips. Only a 404 is nothing stored; every other inbox answer is a failure
// that must name itself rather than hand back the spent link. The fixtures are
// 0509.io links, so the lane is pinned to no lane.
describe("staleLinks", () => {
  beforeEach(() => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is empty when the inbox holds nothing for the address", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
    await expect(staleLinks("e2e+stale@0509.io", "token")).resolves.toEqual([]);
  });

  it("carries the link the address already has stored", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(PLAIN, { status: 200 })));
    await expect(staleLinks("e2e+stale@0509.io", "token")).resolves.toEqual([EXPECTED]);
  });

  it("is empty when the stored message carries no verify link", async () => {
    vi.stubGlobal(
      "fetch",
      () => Promise.resolve(new Response("Subject: hello\n\nno link here", { status: 200 })),
    );
    await expect(staleLinks("e2e+stale@0509.io", "token")).resolves.toEqual([]);
  });

  it("rethrows a non-404 answer instead of reading it as nothing stored", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 403 })));
    const failure = staleLinks("e2e+stale@0509.io", "token");
    await expect(failure).rejects.toBeInstanceOf(InboxReadError);
    await expect(failure).rejects.toMatchObject({ status: 403 });
  });

  it("rethrows an inbox failure carrying its status", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 500 })));
    await expect(staleLinks("e2e+stale@0509.io", "token")).rejects.toBeInstanceOf(InboxReadError);
  });

  // The seam itself: what the pre-read found is what the poll skips, so a fixed
  // address lands on the newer message and not on the stored, spent one.
  it("keeps the poll off the link the pre-read found", async () => {
    const stale = "https://0509.io/api/auth/magic-link/verify?token=stale&callbackURL=%2Fapp";
    const fresh = "https://0509.io/api/auth/magic-link/verify?token=fresh&callbackURL=%2Fapp";
    let stored = `Sign in to Five to Nine:\n\n${stale}`;
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(stored, { status: 200 })));
    const exclude = await staleLinks("e2e+stale@0509.io", "token");
    const pending = waitForMagicLink("e2e+stale@0509.io", "token", exclude);
    setTimeout(() => {
      stored = `Sign in to Five to Nine:\n\n${fresh}`;
    }, 100);
    await expect(pending).resolves.toBe(fresh);
  }, 20_000);
});
