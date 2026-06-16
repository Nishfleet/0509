import type { AppEnv } from "~/lib/env.server";

const encoder = new TextEncoder();

function unsubscribePayload(input: { userId: string; targetId: string }) {
  return `unsubscribe:${input.userId}:${input.targetId}`;
}

function unsubscribeSecrets(env: AppEnv) {
  return [env.UNSUBSCRIBE_SIGNING_SECRET?.trim(), env.BETTER_AUTH_SECRET?.trim()].filter(
    (secret, index, secrets): secret is string =>
      Boolean(secret) && secrets.indexOf(secret) === index,
  );
}

async function importUnsubscribeKey(secret: string | undefined) {
  if (!secret) {
    return null;
  }

  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function buildUnsubscribeSignature(
  env: AppEnv,
  input: { userId: string; targetId: string },
) {
  const key = await importUnsubscribeKey(unsubscribeSecrets(env)[0]);
  if (!key) {
    return null;
  }

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(unsubscribePayload(input)),
  );
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyUnsubscribeSignature(
  env: AppEnv,
  input: { userId: string; targetId: string; signature: string },
) {
  const secrets = unsubscribeSecrets(env);
  if (secrets.length === 0) {
    return false;
  }

  const normalized = input.signature.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    return false;
  }

  const signatureBytes = new Uint8Array(
    normalized.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)),
  );
  for (const secret of secrets) {
    const key = await importUnsubscribeKey(secret);
    if (
      key &&
      (await crypto.subtle.verify(
        "HMAC",
        key,
        signatureBytes,
        encoder.encode(unsubscribePayload(input)),
      ))
    ) {
      return true;
    }
  }

  return false;
}

export async function buildUnsubscribeUrl(
  env: AppEnv,
  input: { userId: string; targetId: string },
) {
  const baseUrl = env.APP_ORIGIN?.trim() || env.BETTER_AUTH_URL?.trim();
  if (!baseUrl) {
    return null;
  }

  const signature = await buildUnsubscribeSignature(env, input);
  if (!signature) {
    return null;
  }

  const url = new URL("/unsubscribe", baseUrl);
  url.searchParams.set("u", input.userId);
  url.searchParams.set("t", input.targetId);
  url.searchParams.set("sig", signature);
  return url.toString();
}
