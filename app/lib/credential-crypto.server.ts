import type { AppEnv } from "~/lib/env.server";

const ENCRYPTION_VERSION = "v1";
const IV_BYTES = 12;

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

function base64UrlToBytes(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function resolveCredentialSecret(env: AppEnv) {
  const dedicatedSecret = env.META_TOKEN_ENCRYPTION_SECRET?.trim();
  if (dedicatedSecret && dedicatedSecret.length >= 32) {
    return dedicatedSecret;
  }

  throw new Error("META_TOKEN_ENCRYPTION_SECRET must be configured with a 32+ character value.");
}

async function deriveAesKey(secret: string) {
  const secretBytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", secretBytes);
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(env: AppEnv, plaintext: string) {
  const key = await deriveAesKey(resolveCredentialSecret(env));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    new TextEncoder().encode(plaintext),
  );

  return [
    ENCRYPTION_VERSION,
    bytesToBase64Url(iv),
    bytesToBase64Url(new Uint8Array(ciphertext)),
  ].join(":");
}

export async function decryptCredential(env: AppEnv, encryptedValue: string) {
  const [version, ivValue, ciphertextValue] = encryptedValue.split(":");
  if (version !== ENCRYPTION_VERSION || !ivValue || !ciphertextValue) {
    throw new Error("Unsupported encrypted credential format.");
  }

  const key = await deriveAesKey(resolveCredentialSecret(env));
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlToBytes(ivValue),
    },
    key,
    base64UrlToBytes(ciphertextValue),
  );

  return new TextDecoder().decode(plaintext);
}

export async function credentialFingerprint(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}
