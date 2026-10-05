import { parseSlackWebhook } from "./slack-webhook";
import { sha256Hex } from "./sha256";

const PREFIX = "enc:";
const KEYED_VERSION = "v2";
const LEGACY_VERSION = "v1";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const KEY_ID_LENGTH = 16;

interface StoredEnvelope {
  readonly keyId: string | null;
  readonly payload: string;
}

export function isEncryptedSlackTarget(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export async function slackTargetKeyId(secret: string): Promise<string> {
  return (await sha256Hex(secret)).slice(0, KEY_ID_LENGTH);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function copyBytes(source: Uint8Array, start = 0, end = source.byteLength): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(end - start));
  bytes.set(source.subarray(start, end));
  return bytes;
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

function parseEnvelope(stored: string): StoredEnvelope | null {
  if (!stored.startsWith(PREFIX)) return null;
  const withoutPrefix = stored.slice(PREFIX.length);
  const versionEnd = withoutPrefix.indexOf(":");
  if (versionEnd < 1) return null;
  const version = withoutPrefix.slice(0, versionEnd);
  const rest = withoutPrefix.slice(versionEnd + 1);
  if (version === LEGACY_VERSION) return { keyId: null, payload: rest };
  if (version !== KEYED_VERSION) return null;
  const payloadStart = rest.indexOf(":");
  if (payloadStart < 1) return null;
  return { keyId: rest.slice(0, payloadStart), payload: rest.slice(payloadStart + 1) };
}

async function sealedWith(envelope: StoredEnvelope, secret: string): Promise<boolean> {
  return envelope.keyId === null || envelope.keyId === (await slackTargetKeyId(secret));
}

export async function isSealedWithKey(stored: string, secret: string): Promise<boolean> {
  const envelope = parseEnvelope(stored);
  return envelope?.keyId === (await slackTargetKeyId(secret));
}

function boundWorkspace(workspaceId: string): Uint8Array<ArrayBuffer> {
  return copyBytes(new TextEncoder().encode(workspaceId));
}

export async function encryptSlackWebhook(url: string, secret: string, workspaceId: string): Promise<string> {
  const webhook = parseSlackWebhook(url);
  if (webhook === null) throw new Error("Slack webhook address is not valid");
  const iv = new Uint8Array(new ArrayBuffer(IV_LENGTH));
  crypto.getRandomValues(iv);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: boundWorkspace(workspaceId) },
      await importSecret(secret),
      copyBytes(new TextEncoder().encode(webhook)),
    ),
  );
  const packed = new Uint8Array(new ArrayBuffer(iv.byteLength + sealed.byteLength));
  packed.set(iv);
  packed.set(sealed, iv.byteLength);
  return `${PREFIX}${KEYED_VERSION}:${await slackTargetKeyId(secret)}:${bytesToBase64(packed)}`;
}

export async function decryptSlackWebhook(stored: string, secret: string, workspaceId: string): Promise<string> {
  if (!isEncryptedSlackTarget(stored)) throw new Error("Slack target is not encrypted");
  const envelope = parseEnvelope(stored);
  if (envelope === null || !(await sealedWith(envelope, secret))) {
    throw new Error("Slack target could not be decrypted");
  }
  let packed: Uint8Array<ArrayBuffer>;
  try {
    packed = base64ToBytes(envelope.payload);
  } catch (error) {
    throw new Error("Slack target could not be decrypted", { cause: error });
  }
  if (packed.byteLength < IV_LENGTH + 16) throw new Error("Slack target could not be decrypted");
  const iv = copyBytes(packed, 0, IV_LENGTH);
  const sealed = copyBytes(packed, IV_LENGTH);
  let bytes: ArrayBuffer;
  try {
    bytes = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: boundWorkspace(workspaceId) },
      await importSecret(secret),
      sealed,
    );
  } catch (error) {
    throw new Error("Slack target could not be decrypted", { cause: error });
  }
  const webhook = parseSlackWebhook(new TextDecoder().decode(bytes));
  if (webhook === null) throw new Error("Slack target could not be decrypted");
  return webhook;
}

export async function decryptSlackWebhookWithKeys(
  stored: string,
  secrets: readonly string[],
  workspaceId: string,
): Promise<string> {
  let failure: unknown = new Error("Slack target could not be decrypted");
  for (const secret of secrets) {
    try {
      return await decryptSlackWebhook(stored, secret, workspaceId);
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
