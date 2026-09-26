const ASSERTION_HEADER = "cf-access-jwt-assertion";
const SERVICE_TOKEN_SUFFIX = ".access";
const JWKS_TTL_MS = 60 * 60 * 1000;

export interface AccessPreclearanceEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

interface AccessJwk {
  kty: string;
  kid: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
}

let cachedJwks: { iss: string; at: number; keys: Map<string, AccessJwk> } | undefined;

async function accessJwks(iss: string, fresh: boolean): Promise<Map<string, AccessJwk>> {
  if (!fresh && cachedJwks?.iss === iss && Date.now() - cachedJwks.at < JWKS_TTL_MS) {
    return cachedJwks.keys;
  }
  const response = await fetch(`${iss}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access JWKS at ${iss} answered HTTP ${String(response.status)}`);
  const body: { keys?: AccessJwk[] } = await response.json();
  const keys = new Map<string, AccessJwk>();
  for (const key of body.keys ?? []) keys.set(key.kid, key);
  cachedJwks = { iss, at: Date.now(), keys };
  return keys;
}

function decodeBase64url(input: string): Uint8Array {
  let base64 = input.replaceAll("-", "+").replaceAll("_", "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface AccessClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  sub?: string;
  common_name?: string;
}

async function denialReason(
  assertion: string,
  config: { iss: string; aud: string },
): Promise<string | null> {
  const parts = assertion.split(".");
  if (parts.length !== 3) return "malformed-jwt";
  const [head, payload, signature] = parts;
  let claims: AccessClaims;
  let kid: string;
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64url(head))) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || typeof header.kid !== "string") return "unsupported-header";
    kid = header.kid;
    claims = JSON.parse(new TextDecoder().decode(decodeBase64url(payload))) as AccessClaims;
  } catch (error) {
    return `unparseable-jwt: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (claims.iss !== config.iss) return "issuer-mismatch";
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(config.aud)) return "audience-mismatch";
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= Date.now()) return "expired";
  if (claims.sub !== "" || typeof claims.common_name !== "string" || !claims.common_name.endsWith(SERVICE_TOKEN_SUFFIX)) {
    return "not-a-service-token";
  }
  let jwk = (await accessJwks(config.iss, false)).get(kid);
  jwk ??= (await accessJwks(config.iss, true)).get(kid);
  if (jwk === undefined) return "unknown-kid";
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: false },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64url(signature),
    new TextEncoder().encode(`${head}.${payload}`),
  );
  return valid ? null : "bad-signature";
}

export async function accessPrecleared(request: Request, env: AccessPreclearanceEnv): Promise<boolean> {
  const iss = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  const assertion = request.headers.get(ASSERTION_HEADER);
  if (!iss || !aud || !assertion) return false;
  try {
    const reason = await denialReason(assertion, { iss, aud });
    if (reason === null) return true;
    console.error(JSON.stringify({ event: "access.preclearance_denied", reason }));
    return false;
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "access.preclearance_denied",
        reason: `verify-error: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
    return false;
  }
}
