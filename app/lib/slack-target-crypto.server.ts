import { parseSlackWebhook } from "./slack-webhook";

const PREFIX = "enc:v1:";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export function isEncryptedSlackTarget(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  bytes.forEach((_, index) => {
    bytes[index] = binary.charCodeAt(index);
  });
  return bytes;
}

async function importSecret(secret: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64ToBytes(secret);
  } catch (error) {
    throw new Error("SLACK_TARGET_SECRET must be 32 bytes", { cause: error });
  }
  if (raw.byteLength !== KEY_LENGTH) throw new Error("SLACK_TARGET_SECRET must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSlackWebhook(url: string, secret: string): Promise<string> {
  const webhook = parseSlackWebhook(url);
  if (webhook === null) throw new Error("Slack webhook address is not valid");
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importSecret(secret), new TextEncoder().encode(webhook)),
  );
  const packed = new Uint8Array(iv.byteLength + sealed.byteLength);
  packed.set(iv);
  packed.set(sealed, iv.byteLength);
  return PREFIX + bytesToBase64(packed);
}

export async function decryptSlackWebhook(stored: string, secret: string): Promise<string> {
  if (!isEncryptedSlackTarget(stored)) throw new Error("Slack target is not encrypted");
  let packed: Uint8Array<ArrayBuffer>;
  try {
    packed = base64ToBytes(stored.slice(PREFIX.length));
  } catch (error) {
    throw new Error("Slack target could not be decrypted", { cause: error });
  }
  if (packed.byteLength < IV_LENGTH + 16) throw new Error("Slack target could not be decrypted");
  const iv = packed.subarray(0, IV_LENGTH);
  const sealed = packed.subarray(IV_LENGTH);
  let bytes: ArrayBuffer;
  try {
    bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await importSecret(secret), sealed);
  } catch (error) {
    throw new Error("Slack target could not be decrypted", { cause: error });
  }
  const webhook = parseSlackWebhook(new TextDecoder().decode(bytes));
  if (webhook === null) throw new Error("Slack target could not be decrypted");
  return webhook;
}
