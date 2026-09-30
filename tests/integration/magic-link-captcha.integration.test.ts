import { env } from "cloudflare:test";
import { data } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAuth, createAuthForRequest } from "../../app/lib/auth.server";
import { action as loginAction } from "../../app/routes/login";

const ORIGIN = "http://localhost:8787";
const PASSING_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

function authEnv(sent: string[], secret = "1x0000000000000000000000000000000AA") {
  return {
    DB: env.DB,
    EMAIL: {
      send: async (message: { text?: string }) => {
        sent.push(message.text ?? "");
        return { messageId: "test" };
      },
    },
    SIGN_IN_EMAIL_LIMIT: env.SIGN_IN_EMAIL_LIMIT,
    SIGN_IN_IP_LIMIT: env.SIGN_IN_IP_LIMIT,
    TURNSTILE_SECRET_KEY: secret,
    BETTER_AUTH_SECRET: "integration-test-secret-integration-test-secret",
    BETTER_AUTH_URL: ORIGIN,
  };
}

function magicLinkPost(token?: string): Request {
  const headers = new Headers({ "content-type": "application/json", origin: ORIGIN });
  if (token !== undefined) headers.set("x-captcha-response", token);
  return new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "captcha@test.dev", callbackURL: "/app" }),
  });
}

describe("magic-link captcha", () => {
  it("refuses a post with no turnstile token", async () => {
    const response = await createAuth(authEnv([])).handler(magicLinkPost());
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Missing CAPTCHA response");
  });

  it("sends the link when the published test token passes", async () => {
    const sent: string[] = [];
    const response = await createAuth(authEnv(sent)).handler(magicLinkPost(PASSING_TOKEN));
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("does not put the provider error or address in the magic-link API body", async () => {
    const failing = {
      ...authEnv([]),
      EMAIL: {
        send: async () => {
          throw new Error("account daily sending quota exceeded for captcha@test.dev");
        },
      },
    };
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const response = await createAuth(failing).handler(magicLinkPost(PASSING_TOKEN));
      const body = await response.text();
      expect(response.status).toBe(503);
      expect(body).not.toContain("captcha@test.dev");
      expect(body).not.toContain("account daily sending quota exceeded");
      const text = logged.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain("account daily sending quota exceeded");
      expect(text).toContain("[redacted]");
      expect(text).not.toContain("captcha@test.dev");
    } finally {
      logged.mockRestore();
    }
  });

  it("refuses a token the secret rejects", async () => {
    const sent: string[] = [];
    const response = await createAuth(authEnv(sent, "2x0000000000000000000000000000000AA")).handler(
      magicLinkPost(PASSING_TOKEN),
    );
    expect(response.status).toBe(403);
    expect(sent).toHaveLength(0);
  });
});

// The Access pre-clearance path (#4702, #5631): a request carrying a verified
// service-token assertion is already authenticated at the edge, so the
// captcha does not apply to it. Everything else — a forged header, a
// user-session assertion, no header — is still checked.
const ACCESS_AUD = "aud-tag-test";
let accessIssuerSeq = 0;
function freshAccessIssuer() {
  accessIssuerSeq += 1;
  return `https://access-${String(accessIssuerSeq)}.test`;
}

function b64u(input: string | Uint8Array): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function mintAccessJwt(key: CryptoKey, claims: Record<string, unknown>, kid = "test-kid"): Promise<string> {
  const head = b64u(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(new Uint8Array(signature))}`;
}

function stubAccessJwks(iss: string, jwk: JsonWebKey) {
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

function preclearedPost(assertion: string): Request {
  return new Request(`${ORIGIN}/api/auth/sign-in/magic-link`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "cf-access-jwt-assertion": assertion,
    },
    body: JSON.stringify({ email: "precleared@test.dev", callbackURL: "/app" }),
  });
}

describe("magic-link captcha access pre-clearance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the link for a verified service-token assertion with no captcha field", async () => {
    const iss = freshAccessIssuer();
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    jwk.kid = "test-kid";
    stubAccessJwks(iss, jwk);
    const assertion = await mintAccessJwt(pair.privateKey, {
      type: "app",
      iss,
      aud: ACCESS_AUD,
      sub: "",
      common_name: "19148d8d2392dad85a35d1d02591c769.access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const sent: string[] = [];
    const envWithAccess = { ...authEnv(sent), ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: ACCESS_AUD };
    const request = preclearedPost(assertion);
    const response = await (await createAuthForRequest(envWithAccess, request)).handler(request);
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("still refuses a post with a forged assertion and no captcha field", async () => {
    const sent: string[] = [];
    const envWithAccess = { ...authEnv(sent), ACCESS_TEAM_DOMAIN: freshAccessIssuer(), ACCESS_AUD: ACCESS_AUD };
    const request = preclearedPost("forged.header.value");
    const response = await (await createAuthForRequest(envWithAccess, request)).handler(request);
    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("still refuses a correctly signed user-session assertion, which is not a service token", async () => {
    const iss = freshAccessIssuer();
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    jwk.kid = "test-kid";
    stubAccessJwks(iss, jwk);
    const assertion = await mintAccessJwt(pair.privateKey, {
      type: "app",
      iss,
      aud: ACCESS_AUD,
      sub: "3f5a6c1e-0000-4a0b-9c1d-useruuid",
      email: "person@0509.io",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const sent: string[] = [];
    const envWithAccess = { ...authEnv(sent), ACCESS_TEAM_DOMAIN: iss, ACCESS_AUD: ACCESS_AUD };
    const request = preclearedPost(assertion);
    const response = await (await createAuthForRequest(envWithAccess, request)).handler(request);
    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

// #5640: the e2e lane drives the route action, and React Router submits
// <Form> posts to `/login.data` — a path Access does not front. The only
// credential on that request is the CF_Authorization cookie (the same JWT
// Access would inject as cf-access-jwt-assertion). The action must still
// reach {sent}; a forged or user-session cookie must still refuse.
describe("login form action access pre-clearance", () => {
  const keys = ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "EMAIL"] as const;
  const saved = new Map<string, unknown>();

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of keys) {
      if (saved.has(key)) Reflect.set(env, key, saved.get(key));
      else Reflect.deleteProperty(env, key);
      saved.delete(key);
    }
  });

  function actionEnv(sent: string[], iss: string) {
    for (const key of keys) if (!saved.has(key)) saved.set(key, Reflect.get(env, key));
    Reflect.set(env, "ACCESS_TEAM_DOMAIN", iss);
    Reflect.set(env, "ACCESS_AUD", ACCESS_AUD);
    Reflect.set(env, "EMAIL", {
      send: async (message: { text?: string }) => {
        sent.push(message.text ?? "");
        return { messageId: "test" };
      },
    });
  }

  async function serviceTokenAssertion(): Promise<{ assertion: string; iss: string }> {
    const iss = freshAccessIssuer();
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const kid = `kid-${crypto.randomUUID()}`;
    jwk.kid = kid;
    stubAccessJwks(iss, jwk);
    return {
      iss,
      assertion: await mintAccessJwt(
        pair.privateKey,
        {
          type: "app",
          iss,
          aud: ACCESS_AUD,
          sub: "",
          common_name: "19148d8d2392dad85a35d1d02591c769.access",
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 3600,
        },
        kid,
      ),
    };
  }

  function loginFormPost(cookie: string | null): Request {
    const form = new FormData();
    form.set("email", "cookie-precleared@test.dev");
    form.set("cf-turnstile-response", "");
    const headers = new Headers();
    if (cookie !== null) headers.set("cookie", cookie);
    return new Request(`${ORIGIN}/login.data`, { method: "POST", headers, body: form });
  }

  it("returns {sent} for a form post carrying a verified service-token cookie and an empty captcha field", async () => {
    const { assertion, iss } = await serviceTokenAssertion();
    const sent: string[] = [];
    actionEnv(sent, iss);
    const result = await loginAction({ request: loginFormPost(`CF_Authorization=${assertion}`) });
    expect(result).toMatchObject({ sent: { email: "cookie-precleared@test.dev" } });
    expect(sent).toHaveLength(1);
  });

  it("returns 503 and the send-failed copy when the provider rejects the send", async () => {
    const { assertion, iss } = await serviceTokenAssertion();
    for (const key of keys) if (!saved.has(key)) saved.set(key, Reflect.get(env, key));
    Reflect.set(env, "ACCESS_TEAM_DOMAIN", iss);
    Reflect.set(env, "ACCESS_AUD", ACCESS_AUD);
    Reflect.set(env, "EMAIL", {
      send: async () => {
        throw new Error("account daily sending quota exceeded for cookie-precleared@test.dev");
      },
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await loginAction({ request: loginFormPost(`CF_Authorization=${assertion}`) });
      expect(result).toEqual(
        data({ error: "We couldn't send the link. Try again in a minute." }, { status: 503 }),
      );
      const text = logged.mock.calls.map((call) => String(call[0])).join("\n");
      expect(text).toContain("account daily sending quota exceeded");
      expect(text).toContain("[redacted]");
      expect(text).not.toContain("cookie-precleared@test.dev");
    } finally {
      logged.mockRestore();
    }
  });

  it("still refuses a form post with a forged cookie assertion and empty captcha", async () => {
    const iss = freshAccessIssuer();
    const published = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", published.publicKey);
    const kid = `kid-${crypto.randomUUID()}`;
    jwk.kid = kid;
    stubAccessJwks(iss, jwk);
    const attacker = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const assertion = await mintAccessJwt(
      attacker.privateKey,
      {
        type: "app",
        iss,
        aud: ACCESS_AUD,
        sub: "",
        common_name: "19148d8d2392dad85a35d1d02591c769.access",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      kid,
    );

    const sent: string[] = [];
    actionEnv(sent, iss);
    const result = await loginAction({ request: loginFormPost(`CF_Authorization=${assertion}`) });
    expect(result).toEqual({ error: "Confirm you're a person, then we'll send the link." });
    expect(sent).toHaveLength(0);
  });

  it("still refuses a form post whose cookie assertion is a user session, not a service token", async () => {
    const iss = freshAccessIssuer();
    const pair = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const kid = `kid-${crypto.randomUUID()}`;
    jwk.kid = kid;
    stubAccessJwks(iss, jwk);
    const assertion = await mintAccessJwt(
      pair.privateKey,
      {
        type: "app",
        iss,
        aud: ACCESS_AUD,
        sub: "3f5a6c1e-0000-4a0b-9c1d-useruuid",
        email: "person@0509.io",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      },
      kid,
    );

    const sent: string[] = [];
    actionEnv(sent, iss);
    const result = await loginAction({ request: loginFormPost(`CF_Authorization=${assertion}`) });
    expect(result).toEqual({ error: "Confirm you're a person, then we'll send the link." });
    expect(sent).toHaveLength(0);
  });
});
