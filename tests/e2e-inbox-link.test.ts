import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

// The fixtures' links ride the production origin, so the default lane is the
// one these cases need: pin both lane variables unset rather than trusting
// the ambient environment, and let a describe's own stubs override per test.
beforeEach(() => {
  vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "");
  vi.stubEnv("PLAYWRIGHT_LOCAL_PORT", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractMagicLink", () => {
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

// 0509#5841: a verify link is only the lane's own origin. The production and
// merge-queue lanes mail their own baseURL; a link on any other origin is a
// different run's mail and returns null.
describe("extractMagicLink on a named lane", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a link on the PLAYWRIGHT_TEST_BASE_URL origin", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "https://mq-1-0509-preview.example.workers.dev");
    const link =
      "https://mq-1-0509-preview.example.workers.dev/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp";
    expect(extractMagicLink(`Sign in to Five to Nine:\n\n${link}`)).toBe(link);
  });

  it("rejects a production link when the lane is a preview", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "https://mq-1-0509-preview.example.workers.dev");
    expect(extractMagicLink(PLAIN)).toBeNull();
  });

  // 0509#6092: the local lane's wrangler dev mails the --var BETTER_AUTH_URL
  // playwright.config.ts gives it, so the local link is on the pinned port.
  // PLAYWRIGHT_TEST_BASE_URL is stubbed empty so a caller's environment cannot
  // pull these cases onto the remote lane.
  it("returns a link on the local port when no base URL is set", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "");
    vi.stubEnv("PLAYWRIGHT_LOCAL_PORT", "8791");
    const link = "http://127.0.0.1:8791/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp";
    expect(extractMagicLink(`Sign in to Five to Nine\n\n${link}`)).toBe(link);
  });

  it("rejects a link on a different port", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "");
    vi.stubEnv("PLAYWRIGHT_LOCAL_PORT", "8791");
    expect(
      extractMagicLink(
        "Sign in to Five to Nine\n\nhttp://127.0.0.1:9999/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp",
      ),
    ).toBeNull();
  });

  it("rejects a production link when the lane is local", () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "");
    vi.stubEnv("PLAYWRIGHT_LOCAL_PORT", "8791");
    expect(extractMagicLink(PLAIN)).toBeNull();
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
// that must name itself rather than hand back the spent link. These cases pin
// the remote lane, so they name a production base URL (0509#6092).
describe("staleLinks", () => {
  beforeEach(() => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "https://0509.io");
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

// 0509#6092: the local lane reads wrangler's simulated send_email output —
// one file per part under .wrangler/tmp/email/<session>/email-{text,html}/.
// These cases point the reader at a temp cwd carrying the same layout.
describe("the local lane disk sink", () => {
  const TO = "e2e+local@0509.io";
  const LOCAL_LINK = "http://127.0.0.1:8791/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp";
  let dir: string;

  async function writeEmail(to: string, link: string): Promise<void> {
    const partDir = join(dir, ".wrangler", "tmp", "email", "session-1", "email-text");
    await mkdir(partDir, { recursive: true });
    await writeFile(
      join(partDir, `${crypto.randomUUID()}@0509.io.txt`),
      `Sign in to Five to Nine\n\nWe sent this link to ${to}.\n\n${link}`,
    );
  }

  beforeEach(async () => {
    vi.stubEnv("PLAYWRIGHT_TEST_BASE_URL", "");
    vi.stubEnv("PLAYWRIGHT_LOCAL_PORT", "8791");
    dir = await mkdtemp(join(tmpdir(), "e2e-inbox-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
  });

  it("carries the link a file for the recipient holds", async () => {
    await writeEmail(TO, LOCAL_LINK);
    await expect(staleLinks(TO, null)).resolves.toEqual([LOCAL_LINK]);
  });

  it("is empty when nothing was written", async () => {
    await expect(staleLinks(TO, null)).resolves.toEqual([]);
  });

  it("ignores a file addressed to another recipient", async () => {
    await writeEmail(
      "e2e+other@0509.io",
      "http://127.0.0.1:8791/api/auth/magic-link/verify?token=other&callbackURL=%2Fapp",
    );
    await expect(staleLinks(TO, null)).resolves.toEqual([]);
  });

  it("keeps the wait off an excluded link until the fresh one lands", async () => {
    const fresh = "http://127.0.0.1:8791/api/auth/magic-link/verify?token=fresh&callbackURL=%2Fapp";
    await writeEmail(TO, LOCAL_LINK);
    const pending = waitForMagicLink(TO, null, [LOCAL_LINK]);
    setTimeout(() => {
      void writeEmail(TO, fresh);
    }, 100);
    await expect(pending).resolves.toBe(fresh);
  }, 20_000);
});
