import { describe, expect, it } from "vitest";

import { extractMagicLink } from "../e2e/inbox";

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

  it("reads a preview deployment host and rejects any other host", () => {
    const preview =
      "https://718ec890-0509.nishant345.workers.dev/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp";
    expect(extractMagicLink(`Sign in:\n\n${preview}`)).toBe(preview);
    expect(
      extractMagicLink(
        "https://evil.example/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp",
      ),
    ).toBeNull();
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
