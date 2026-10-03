import { beforeEach, describe, expect, it, vi } from "vitest";

const vars = vi.hoisted(() => ({ env: { BETTER_AUTH_SECRET: "secret-one" } }));

vi.mock("cloudflare:workers", () => ({ env: vars.env }));

import { checkoutProof, isCheckoutProof } from "../../app/lib/billing/checkout-proof.server";

beforeEach(() => {
  vars.env.BETTER_AUTH_SECRET = "secret-one";
});

describe("checkout proof", () => {
  it("accepts the proof it made for the same workspace and product", async () => {
    const proof = await checkoutProof("ws-1", "pdt-1");
    expect(proof).toMatch(/^[0-9a-f]{64}$/);
    expect(await isCheckoutProof("ws-1", "pdt-1", proof)).toBe(true);
  });

  it("rejects it for another workspace or another product", async () => {
    const proof = await checkoutProof("ws-1", "pdt-1");
    expect(await isCheckoutProof("ws-2", "pdt-1", proof)).toBe(false);
    expect(await isCheckoutProof("ws-1", "pdt-2", proof)).toBe(false);
  });

  it("rejects a proof made under another secret", async () => {
    const proof = await checkoutProof("ws-1", "pdt-1");
    vars.env.BETTER_AUTH_SECRET = "secret-two";
    expect(await isCheckoutProof("ws-1", "pdt-1", proof)).toBe(false);
  });

  it("rejects missing, empty, odd-length, non-hex and altered proofs", async () => {
    const proof = await checkoutProof("ws-1", "pdt-1");
    const altered = `${proof.slice(0, -1)}${proof.endsWith("0") ? "1" : "0"}`;
    for (const bad of [undefined, "", "abc", "zz".repeat(32), altered, proof.slice(2)]) {
      expect(await isCheckoutProof("ws-1", "pdt-1", bad)).toBe(false);
    }
  });
});
