import { env } from "cloudflare:workers";
import { generateNonce, SIGNATURE_AGENT_HEADER, sign } from "web-bot-auth";
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

export function readSigningKey(raw: unknown): SigningKey | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = signingKey.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch (error) {
    console.error(JSON.stringify({ event: "web_bot_auth.key_unreadable", error: String(error) }));
    return null;
  }
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

export async function signedHeaders(url: string, headers: HeadersInit, now: Date): Promise<HeadersInit> {
  const out = new Headers(headers);
  const key = configuredKey();
  if (key === null || out.get("user-agent") !== CRAWLER_USER_AGENT) return headers;
  out.set(SIGNATURE_AGENT_HEADER, `${AGENT_KEY}="${SITE_URL}";type=directory`);
  const fields = await sign(new Request(url, { headers: out }), {
    signer: await signerFromJWK(key),
    created: now,
    expires: new Date(now.getTime() + SIGNATURE_LIFETIME_MS),
    nonce: generateNonce(),
    signatureAgentKey: AGENT_KEY,
  });
  out.set("signature", fields.signature);
  out.set("signature-input", fields.signatureInput);
  return out;
}
