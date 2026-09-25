const ACCESS_TEAM = "https://nish345.cloudflareaccess.com";
const ACCESS_AUD = "b4fa400a1848c913b92c3212dc0714fcdbd1b1b66eb24659e4a7cc01c790575d";
const ACCESS_CERTS = `${ACCESS_TEAM}/cdn-cgi/access/certs`;
const KEY_TTL_MS = 60 * 60 * 1000;
const REFRESH_GAP_MS = 60_000;

export interface AccessJwk {
  kid: string;
  n: string;
  e: string;
}

interface ClearanceDeps {
  loadKeys: (force: boolean) => Promise<readonly AccessJwk[]>;
  nowSeconds: number;
}

let cachedKeys: { at: number; keys: readonly AccessJwk[] } | undefined;
let lastForceAt = 0;

function tokenFrom(request: Request): string {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header !== null && header.length > 0) return header;
  const cookie = request.headers.get("cookie");
  if (cookie === null) return "";
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) === "CF_Authorization") return trimmed.slice(eq + 1);
  }
  return "";
}

function bytesFromBase64Url(part: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    const padded = part.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (part.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch (error) {
    if (error instanceof DOMException) return undefined;
    throw error;
  }
}

function jsonFromPart(part: string): unknown {
  const bytes = bytesFromBase64Url(part);
  if (!bytes) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function audienceMatches(aud: unknown): boolean {
  if (typeof aud === "string") return aud === ACCESS_AUD;
  if (!Array.isArray(aud)) return false;
  return aud.some((item) => item === ACCESS_AUD);
}

function isAgentServiceToken(payload: object, nowSeconds: number): boolean {
  if (Reflect.get(payload, "iss") !== ACCESS_TEAM) return false;
  if (!audienceMatches(Reflect.get(payload, "aud"))) return false;
  const exp: unknown = Reflect.get(payload, "exp");
  if (typeof exp !== "number" || exp <= nowSeconds) return false;
  const nbf: unknown = Reflect.get(payload, "nbf");
  if (typeof nbf === "number" && nbf > nowSeconds) return false;
  if (Reflect.get(payload, "type") !== "app") return false;
  if (Reflect.get(payload, "sub") !== "") return false;
  if (typeof Reflect.get(payload, "email") === "string") return false;
  return true;
}

function parseKeys(body: unknown): AccessJwk[] {
  if (!isObject(body)) return [];
  const keys: unknown = Reflect.get(body, "keys");
  if (!Array.isArray(keys)) return [];
  const parsed: AccessJwk[] = [];
  for (const key of keys) {
    if (!isObject(key)) continue;
    const kid: unknown = Reflect.get(key, "kid");
    const kty: unknown = Reflect.get(key, "kty");
    const alg: unknown = Reflect.get(key, "alg");
    const n: unknown = Reflect.get(key, "n");
    const e: unknown = Reflect.get(key, "e");
    if (typeof kid === "string" && kty === "RSA" && alg === "RS256" && typeof n === "string" && typeof e === "string") {
      parsed.push({ kid, n, e });
    }
  }
  return parsed;
}

async function liveKeys(force: boolean): Promise<readonly AccessJwk[]> {
  const now = Date.now();
  if (!force && cachedKeys && now - cachedKeys.at < KEY_TTL_MS) return cachedKeys.keys;
  const response = await fetch(ACCESS_CERTS);
  if (!response.ok) throw new Error(`access signing keys answered HTTP ${String(response.status)}`);
  const keys = parseKeys(await response.json());
  if (keys.length === 0) throw new Error("access signing keys were empty");
  cachedKeys = { at: now, keys };
  return keys;
}

async function keyFor(kid: string, loadKeys: ClearanceDeps["loadKeys"]): Promise<AccessJwk | undefined> {
  const keys = await loadKeys(false);
  const found = keys.find((key) => key.kid === kid);
  if (found) return found;
  const now = Date.now();
  if (now - lastForceAt < REFRESH_GAP_MS) return undefined;
  lastForceAt = now;
  const fresh = await loadKeys(true);
  return fresh.find((key) => key.kid === kid);
}

async function signatureMatches(
  headerPart: string,
  payloadPart: string,
  signaturePart: string,
  jwk: AccessJwk,
): Promise<boolean> {
  const signature = bytesFromBase64Url(signaturePart);
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, data);
}

export async function accessServiceTokenClearsCaptcha(request: Request, deps?: ClearanceDeps): Promise<boolean> {
  const token = tokenFrom(request);
  if (token.length === 0) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (headerPart === undefined || payloadPart === undefined || signaturePart === undefined) return false;
  if (headerPart.length === 0 || payloadPart.length === 0 || signaturePart.length === 0) return false;
  const header = jsonFromPart(headerPart);
  const payload = jsonFromPart(payloadPart);
  if (!isObject(header) || !isObject(payload)) return false;
  if (Reflect.get(header, "alg") !== "RS256") return false;
  const kid: unknown = Reflect.get(header, "kid");
  if (typeof kid !== "string" || kid.length === 0) return false;
  const loadKeys = deps === undefined ? liveKeys : deps.loadKeys;
  const nowSeconds = deps === undefined ? Math.floor(Date.now() / 1000) : deps.nowSeconds;
  const jwk = await keyFor(kid, loadKeys);
  if (!jwk) return false;
  if (!(await signatureMatches(headerPart, payloadPart, signaturePart, jwk))) return false;
  return isAgentServiceToken(payload, nowSeconds);
}
