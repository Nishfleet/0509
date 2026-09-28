import { describe, expect, it } from "vitest";

import { sha256Hex } from "../../app/lib/sha256";

describe("sha256Hex", () => {
  it("returns the lower-case hex SHA-256 of ASCII text", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns the digest of the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
