import { env } from "cloudflare:workers";
import { generateNonce, SIGNATURE_AGENT_HEADER, sign, type WebBotSigner } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { z } from "zod";

import { SITE_URL } from "../structured-data";
import { CRAWLER_USER_AGENT } from "./crawler-identity";

export const DIRECTORY_CONTENT_TYPE = "application/http-message-signatures-directory+json";

const AGENT_KEY = "sig1";
const SIGNATURE_LIFETIME_MS = 60_000;

const signingKey = z.looseObject({
  kty: z.literal("OKP"),
  crv: z.literal("Ed25519"),
  x: z.string().min(1),
  d: z.string().min(1),
});

type SigningKey = z.infer<typeof signingKey>;

interface SignRequest {
  url: string;
  headers: HeadersInit;
  now: Date;
}

let memo: { raw: string; key: SigningKey | null; signer: Promise<WebBotSigner> | null } | null = null;

function unreadable(kind: "json" | "shape"): null {
  console.error(JSON.stringify({ event: "web_bot_auth.key_unreadable", kind }));
  return null;
}

function parseKey(raw: string): SigningKey | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return unreadable(error instanceof SyntaxError ? "json" : "shape");
  }
  const parsed = signingKey.safeParse(json);
  return parsed.success ? parsed.data : unreadable("shape");
}

export function readSigningKey(raw: unknown): SigningKey | null {
  if (typeof raw !== "string") return null;
  if (memo?.raw === raw) return memo.key;
  const key = parseKey(raw);
  memo = { raw, key, signer: null };
  return key;
}

function configuredKey(): SigningKey | null {
  return readSigningKey(Reflect.get(env, "WEB_BOT_AUTH_KEY"));
}

function publicDirectory(key: SigningKey): { keys: JsonWebKey[] } {
  return { keys: [{ kty: key.kty, crv: key.crv, x: key.x }] };
}

export function directoryBody(): string | null {
  const key = configuredKey();
  return key === null ? null : JSON.stringify(publicDirectory(key));
}

async function memoSigner(key: SigningKey): Promise<WebBotSigner> {
  if (memo === null) throw new Error("signing key not read");
  const current = memo;
  current.signer ??= signerFromJWK(key);
  try {
    return await current.signer;
  } catch (error) {
    current.signer = null;
    throw error;
  }
}

async function signed(request: SignRequest, key: SigningKey): Promise<HeadersInit> {
  const { url, headers, now } = request;
  try {
    const out = new Headers(headers);
    out.set(SIGNATURE_AGENT_HEADER, `${AGENT_KEY}="${SITE_URL}";type=directory`);
    const fields = await sign(new Request(url, { headers: out }), {
      signer: await memoSigner(key),
      created: now,
      expires: new Date(now.getTime() + SIGNATURE_LIFETIME_MS),
      nonce: generateNonce(),
      signatureAgentKey: AGENT_KEY,
    });
    out.set("signature", fields.signature);
    out.set("signature-input", fields.signatureInput);
    return out;
  } catch {
    console.error(JSON.stringify({ event: "web_bot_auth.sign_failed" }));
    return headers;
  }
}

export function signedHeaders(url: string, headers: HeadersInit, now: Date): HeadersInit | Promise<HeadersInit> {
  const key = configuredKey();
  if (key === null || new Headers(headers).get("user-agent") !== CRAWLER_USER_AGENT) return headers;
  return signed({ url, headers, now }, key);
}
