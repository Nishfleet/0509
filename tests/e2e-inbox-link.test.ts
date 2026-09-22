import { describe, expect, it } from "vitest";

import { extractMagicLink } from "../e2e/inbox";

// J1's link extraction, pinned in a merge gate so a mail-format change fails
// here rather than as a 120s production poll timeout (0509#3927). The app
// sends text/plain only; transport quoted-printable-encodes it, so the two
// cases that matter are `=3D` in the query and `=\r\n` soft-wraps mid-URL.
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

describe("extractMagicLink", () => {
  it("finds the verify URL in a plain body", () => {
    expect(extractMagicLink(PLAIN)).toBe(
      "https://0509.io/api/auth/magic-link/verify?token=abc123&callbackURL=%2Fapp",
    );
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
});
