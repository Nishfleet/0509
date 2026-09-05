import type { AppEnv } from "~/lib/env.server";
import type { CustomerApiKeyRecord } from "~/lib/types";

const API_KEY_PREFIX = "f9_live";
const API_KEY_RANDOM_BYTES = 32;
const API_KEY_VISIBLE_BYTES = 10;
const API_KEY_NAME_MAX_LENGTH = 80;

export type ApiKeyAuthResult =
  | { ok: true; apiKey: CustomerApiKeyRecord }
  | { ok: false; response: Response };

export async function createCustomerApiKey(
  env: AppEnv,
  userId: string,
  rawName: string,
  options: {
    actionsWriteEnabled?: boolean;
  } = {},
) {
  const {
    insertCustomerApiKey,
  } = await import("~/lib/data.server");
  const secret = generateApiKeySecret();
  const apiKey = await insertCustomerApiKey(env, {
    userId,
    name: normalizeApiKeyName(rawName),
    keyPrefix: keyPrefixForSecret(secret),
    keyHash: await hashApiKey(secret),
    actionsWriteEnabled: Boolean(options.actionsWriteEnabled),
  });

  return {
    apiKey,
    secret,
  };
}

export async function authenticateApiKeyRequest(
  env: AppEnv,
  request: Request,
): Promise<ApiKeyAuthResult> {
  if (!env.DB) {
    return {
      ok: false,
      response: jsonError("api_unavailable", "API access is temporarily unavailable.", 503),
    };
  }

  const presentedKey = readPresentedApiKey(request);
  if (!presentedKey) {
    return {
      ok: false,
      response: unauthorizedResponse(),
    };
  }

  const {
    getActiveCustomerApiKeyByHash,
    recordCustomerApiKeyUsed,
  } = await import("~/lib/data.server");
  const apiKey = await getActiveCustomerApiKeyByHash(env, await hashApiKey(presentedKey));
  if (!apiKey) {
    return {
      ok: false,
      response: unauthorizedResponse(),
    };
  }

  await recordCustomerApiKeyUsed(env, apiKey.id);
  return { ok: true, apiKey };
}

function generateApiKeySecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(API_KEY_RANDOM_BYTES));
  return `${API_KEY_PREFIX}_${bytesToBase64Url(bytes)}`;
}

function keyPrefixForSecret(secret: string) {
  const randomPart = secret.slice(`${API_KEY_PREFIX}_`.length);
  return `${API_KEY_PREFIX}_${randomPart.slice(0, API_KEY_VISIBLE_BYTES)}`;
}

function normalizeApiKeyName(value: string) {
  const name = value.trim().replace(/\s+/g, " ").slice(0, API_KEY_NAME_MAX_LENGTH);
  return name || "API key";
}

function readPresentedApiKey(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  const bearerMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  const value = bearerMatch?.[1]?.trim() || request.headers.get("x-0509-api-key")?.trim();

  if (!value || !value.startsWith(`${API_KEY_PREFIX}_`)) {
    return null;
  }

  return value;
}

async function hashApiKey(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

function unauthorizedResponse() {
  const response = jsonError(
    "invalid_api_key",
    "Use Authorization: Bearer <Five to Nine API key> with an active key.",
    401,
  );
  response.headers.set("WWW-Authenticate", 'Bearer realm="0509 API"');
  return response;
}

function jsonError(error: string, message: string, status: number) {
  return Response.json(
    {
      error,
      message,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
