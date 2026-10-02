import { beforeEach, describe, expect, it, vi } from "vitest";

const vars = vi.hoisted(() => ({ env: { TESTER_EMAIL_HASHES: "" } }));

vi.mock("cloudflare:workers", () => ({ env: vars.env }));

import { isTester } from "../../app/lib/billing/tester.server";

const HASH_OF_TESTER_AT_EXAMPLE = "0".repeat(64);

async function hashOf(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(() => {
  vars.env.TESTER_EMAIL_HASHES = "";
});

describe("isTester", () => {
  it("lets nobody in while the list is empty", async () => {
    expect(await isTester("tester@example.com")).toBe(false);
  });

  it("matches an email whatever its case or padding", async () => {
    vars.env.TESTER_EMAIL_HASHES = await hashOf("tester@example.com");
    expect(await isTester("tester@example.com")).toBe(true);
    expect(await isTester("  Tester@Example.COM ")).toBe(true);
  });

  it("refuses an email that is not on the list", async () => {
    vars.env.TESTER_EMAIL_HASHES = await hashOf("tester@example.com");
    expect(await isTester("other@example.com")).toBe(false);
  });

  it("reads a comma-separated list and ignores blanks", async () => {
    vars.env.TESTER_EMAIL_HASHES = `, ${HASH_OF_TESTER_AT_EXAMPLE} , ${await hashOf("second@example.com")},`;
    expect(await isTester("second@example.com")).toBe(true);
    expect(await isTester("third@example.com")).toBe(false);
  });
});
