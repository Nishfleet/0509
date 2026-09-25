import { describe, expect, it } from "vitest";

import { accessServiceTokenClearsCaptcha, type AccessJwk } from "../../app/lib/auth/access-clearance";

const ACCESS_TEAM = "https://nish345.cloudflareaccess.com";
const ACCESS_AUD = "b4fa400a1848c913b92c3212dc0714fcdbd1b1b66eb24659e4a7cc01c790575d";
const NOW = 1_800_000_000;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function signedToken(
  privateKey: CryptoKey,
  kid: string,
  payload: object,
): Promise<string> {
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", kid })));
  const body = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${body}`)),
  );
  return `${header}.${body}.${base64Url(signature)}`;
}

function requestWith(token: string): Request {
  return new Request("https://0509.io/api/auth/sign-in/magic-link", {
    headers: { cookie: `CF_Authorization=${token}` },
  });
}

describe("access service token clearance", () => {
  it("accepts a signed service token and rejects a person token or a bad signature", async () => {
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
    if (typeof exported.n !== "string" || typeof exported.e !== "string") {
      throw new Error("access test key was not an RSA jwk");
    }
    const jwk: AccessJwk = { kid: "test-key", n: exported.n, e: exported.e };
    const deps = { loadKeys: async () => [jwk], nowSeconds: NOW };
    const service = {
      iss: ACCESS_TEAM,
      aud: [ACCESS_AUD],
      exp: NOW + 60,
      type: "app",
      sub: "",
    };
    const token = await signedToken(pair.privateKey, "test-key", service);
    await expect(accessServiceTokenClearsCaptcha(requestWith(token), deps)).resolves.toBe(true);

    const person = await signedToken(pair.privateKey, "test-key", { ...service, email: "nish@0509.io", sub: "user" });
    await expect(accessServiceTokenClearsCaptcha(requestWith(person), deps)).resolves.toBe(false);

    const [header, payload, signature] = token.split(".");
    if (header === undefined || payload === undefined || signature === undefined || signature.length === 0) {
      throw new Error("signed token was not three parts");
    }
    const flipped = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    await expect(
      accessServiceTokenClearsCaptcha(requestWith(`${header}.${payload}.${flipped}`), deps),
    ).resolves.toBe(false);
    await expect(
      accessServiceTokenClearsCaptcha(new Request("https://0509.io/api/auth/sign-in/magic-link"), deps),
    ).resolves.toBe(false);
  });
});
