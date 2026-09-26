import { afterEach, describe, expect, it, vi } from "vitest";

import { accessPrecleared } from "../../app/lib/auth/access-preclearance.server";

afterEach(() => {
  vi.unstubAllGlobals();
});

const AUD = "b4fa400a1848c913b92c3212dc0714fcdbd1b1b66eb24659e4a7cc01c790575d";

// A fresh issuer per test keeps the module-level JWKS cache honest: every
// case fetches its own key set, so a pass can never ride a previous case's
// cached keys.
let issuerSeq = 0;
function freshIssuer() {
  issuerSeq += 1;
  return `https://team-${issuerSeq}.test`;
}

async function rsaPair() {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

function b64u(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function mintJwt(key: CryptoKey, claims: Record<string, unknown>, kid = "test-kid"): Promise<string> {
  const head = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(`${head}.${body}`),
  );
  return `${head}.${body}.${b64u(new Uint8Array(signature))}`;
}

function serviceClaims(iss: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "app",
    iss,
    aud: AUD,
    sub: "",
    common_name: "19148d8d2392dad85a35d1d02591c769.access",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...over,
  };
}

function stubJwks(iss: string, jwk: JsonWebKey) {
  const realFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === `${iss}/cdn-cgi/access/certs`) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      return realFetch(input, init);
    }),
  );
}

function request(assertion?: string): Request {
  const headers = new Headers();
  if (assertion !== undefined) headers.set("cf-access-jwt-assertion", assertion);
  return new Request("https://0509.io/login", { method: "POST", headers });
}

describe("accessPrecleared", () => {
  it("clears a verified service-token assertion", async () => {
    const iss = freshIssuer();
    const pair = await rsaPair();
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    jwk.kid = "test-kid";
    stubJwks(iss, jwk);
    const jwt = await mintJwt(pair.privateKey, serviceClaims(iss));

    await expect(
      accessPrecleared(request(jwt), { ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: AUD }),
    ).resolves.toBe(true);
  });

  it("denies a JWT signed by a key the issuer does not publish", async () => {
    const iss = freshIssuer();
    const published = await rsaPair();
    const attacker = await rsaPair();
    const jwk = await crypto.subtle.exportKey("jwk", published.publicKey);
    jwk.kid = "test-kid";
    stubJwks(iss, jwk);
    const jwt = await mintJwt(attacker.privateKey, serviceClaims(iss));

    await expect(
      accessPrecleared(request(jwt), { ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: AUD }),
    ).resolves.toBe(false);
  });

  it("denies a token for a different audience", async () => {
    const iss = freshIssuer();
    const pair = await rsaPair();
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    jwk.kid = "test-kid";
    stubJwks(iss, jwk);
    const jwt = await mintJwt(pair.privateKey, serviceClaims(iss, { aud: "other-app-aud" }));

    await expect(
      accessPrecleared(request(jwt), { ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: AUD }),
    ).resolves.toBe(false);
  });

  it("denies a token issued by a different team domain", async () => {
    const iss = freshIssuer();
    const pair = await rsaPair();
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    jwk.kid = "test-kid";
    stubJwks(iss, jwk);
    const jwt = await mintJwt(pair.privateKey, serviceClaims("https://other.cloudflareaccess.com"));

    await expect(
      accessPrecleared(request(jwt), { ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: AUD }),
    ).resolves.toBe(false);
  });

  it("denies an expired token", async () => {
    const iss = freshIssuer();
    const pair = await rsaPair();
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    jwk.kid = "test-kid";
    stubJwks(iss, jwk);
    const jwt = await mintJwt(
      pair.privateKey,
      serviceClaims(iss, { exp: Math.floor(Date.now() / 1000) - 60 }),
    );

    await expect(
      accessPrecleared(request(jwt), { ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: AUD }),
    ).resolves.toBe(false);
  });

  it("denies a user-session assertion, which is not a service token", async () => {
    const iss = freshIssuer();
    const pair = await rsaPair();
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    jwk.kid = "test-kid";
    stubJwks(iss, jwk);
    const jwt = await mintJwt(
      pair.privateKey,
      serviceClaims(iss, { sub: "3f5a6c1e-0000-4a0b-9c1d-useruuid", common_name: undefined, email: "person@0509.io" }),
    );

    await expect(
      accessPrecleared(request(jwt), { ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: AUD }),
    ).resolves.toBe(false);
  });

  it("denies a garbage assertion without fetching keys", async () => {
    const iss = freshIssuer();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      accessPrecleared(request("not-a-jwt"), { ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: AUD }),
    ).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("denies when no assertion header is present", async () => {
    await expect(
      accessPrecleared(request(), { ACCESS_TEAM_DOMAIN: freshIssuer(), ACCESS_AUD: AUD }),
    ).resolves.toBe(false);
  });

  it("denies when the Access configuration is absent", async () => {
    const jwt = "header.payload.signature";
    await expect(accessPrecleared(request(jwt), {})).resolves.toBe(false);
  });

  it("denies when the JWKS fetch fails", async () => {
    const iss = freshIssuer();
    const pair = await rsaPair();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 500 })),
    );
    const jwt = await mintJwt(pair.privateKey, serviceClaims(iss));

    await expect(
      accessPrecleared(request(jwt), { ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: AUD }),
    ).resolves.toBe(false);
  });
});
