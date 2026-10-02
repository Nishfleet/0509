import { beforeEach, describe, expect, it, vi } from "vitest";
import { verify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";

const vars = vi.hoisted(() => ({ env: {} as Record<string, string> }));

vi.mock("cloudflare:workers", () => ({ env: vars.env }));

import { CRAWLER_USER_AGENT } from "../../../app/lib/fetch/crawler-identity";
import { directoryBody, readSigningKey, signedHeaders } from "../../../app/lib/fetch/web-bot-auth.server";

const TEST_KEY = {
  kty: "OKP",
  crv: "Ed25519",
  alg: "EdDSA",
  kid: "test-key-ed25519",
  d: "n4Ni-HpISpVObnQMW0wOhCKROaIKqKtW_2ZYb2p9KcU",
  x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs",
};
const URL_UNDER_TEST = "https://rival.example/pricing";
const NOW = new Date("2026-10-02T10:00:00Z");

beforeEach(() => {
  delete vars.env.WEB_BOT_AUTH_KEY;
});

describe("signedHeaders without a key", () => {
  it("sends the request exactly as it was", async () => {
    const headers = { "user-agent": CRAWLER_USER_AGENT };
    expect(await signedHeaders(URL_UNDER_TEST, headers, NOW)).toBe(headers);
  });

  it.each(["", "not json {", JSON.stringify({ kty: "RSA" }), JSON.stringify({ ...TEST_KEY, d: undefined })])(
    "treats %j as no key",
    async (raw) => {
      vars.env.WEB_BOT_AUTH_KEY = raw;
      const headers = { "user-agent": CRAWLER_USER_AGENT };
      expect(await signedHeaders(URL_UNDER_TEST, headers, NOW)).toBe(headers);
      expect(directoryBody()).toBeNull();
    },
  );
});

describe("signedHeaders with a key", () => {
  it("adds headers that a verifier holding only the public key accepts", async () => {
    vars.env.WEB_BOT_AUTH_KEY = JSON.stringify(TEST_KEY);
    const out = new Headers(await signedHeaders(URL_UNDER_TEST, { "user-agent": CRAWLER_USER_AGENT }, NOW));
    expect(out.get("user-agent")).toBe(CRAWLER_USER_AGENT);
    expect(out.get("signature-agent")).toBe('sig1="https://0509.io";type=directory');
    const { d: _private, ...publicKey } = TEST_KEY;
    const verifier = await verifierFromJWK(publicKey);
    const verified = await verify(new Request(URL_UNDER_TEST, { headers: out }), {
      resolver: () => verifier,
      validate: () => undefined,
      now: NOW,
    });
    expect(verified.keyid).toBe(verifier.keyid);
  });

  it("signs each request with a fresh nonce", async () => {
    vars.env.WEB_BOT_AUTH_KEY = JSON.stringify(TEST_KEY);
    const headers = { "user-agent": CRAWLER_USER_AGENT };
    const first = new Headers(await signedHeaders(URL_UNDER_TEST, headers, NOW));
    const second = new Headers(await signedHeaders(URL_UNDER_TEST, headers, NOW));
    expect(first.get("signature-input")).not.toBe(second.get("signature-input"));
  });

  it("leaves requests that are not the crawler's own alone", async () => {
    vars.env.WEB_BOT_AUTH_KEY = JSON.stringify(TEST_KEY);
    const headers = { Authorization: "Bearer x" };
    expect(await signedHeaders(URL_UNDER_TEST, headers, NOW)).toBe(headers);
  });

  it("publishes the public key and never the private one", () => {
    vars.env.WEB_BOT_AUTH_KEY = JSON.stringify(TEST_KEY);
    const body = directoryBody() ?? "";
    expect(JSON.parse(body)).toEqual({ keys: [{ kty: "OKP", crv: "Ed25519", x: TEST_KEY.x }] });
    expect(body).not.toContain(TEST_KEY.d);
  });

  it("reads a valid key from its JSON text", () => {
    expect(readSigningKey(JSON.stringify(TEST_KEY))?.x).toBe(TEST_KEY.x);
    expect(readSigningKey(undefined)).toBeNull();
  });
});
