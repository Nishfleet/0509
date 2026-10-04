import { describe, expect, it } from "vitest";

import { sha256Hex } from "../app/lib/sha256";

// sha256Hex wraps crypto.subtle.digest and lower-cases the bytes, so the
// output is always a 64-char hex string. These cases pin the known vectors and
// the UTF-8 encoding of multi-byte input.
describe("sha256Hex", () => {
  it("hashes the empty string to its known SHA-256 digest", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hashes 'abc' to its known SHA-256 digest", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("always returns a lowercase 64-char hex string, including for multi-byte input", async () => {
    expect(await sha256Hex("é")).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("e")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for a multi-byte input versus its single-byte spelling", async () => {
    expect(await sha256Hex("é")).not.toBe(await sha256Hex("e"));
  });

  it("returns the same output for the same input twice", async () => {
    expect(await sha256Hex("abc")).toBe(await sha256Hex("abc"));
  });
});
