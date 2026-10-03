import { env } from "cloudflare:workers";

import { checkoutProofMessage } from "./checkout-proof";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/.test(hex)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  bytes.forEach((_, index) => {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  });
  return bytes;
}

let cached: { secret: string; key: Promise<CryptoKey> } | null = null;

function signingKey(): Promise<CryptoKey> {
  const secret = env.BETTER_AUTH_SECRET;
  if (cached?.secret !== secret) {
    cached = {
      secret,
      key: crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
      ]),
    };
  }
  return cached.key;
}

function message(workspaceId: string, productId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(checkoutProofMessage(workspaceId, productId));
}

export async function checkoutProof(workspaceId: string, productId: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(), message(workspaceId, productId));
  return bytesToHex(new Uint8Array(signature));
}

export async function isCheckoutProof(
  workspaceId: string,
  productId: string,
  proof: string | undefined,
): Promise<boolean> {
  const bytes = hexToBytes(proof ?? "");
  if (bytes === null) return false;
  return crypto.subtle.verify("HMAC", await signingKey(), bytes, message(workspaceId, productId));
}
