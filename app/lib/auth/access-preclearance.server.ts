import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload } from "jose";

const ASSERTION_HEADER = "cf-access-jwt-assertion";
const ASSERTION_COOKIE = "CF_Authorization";
const SERVICE_TOKEN_SUFFIX = ".access";

export interface AccessPreclearanceEnv {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(iss: string) {
  const cached = jwksByIssuer.get(iss);
  if (cached) return cached;
  const jwks = createRemoteJWKSet(new URL(`${iss}/cdn-cgi/access/certs`));
  jwksByIssuer.set(iss, jwks);
  return jwks;
}

function verifyDenial(error: unknown): string {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "iss") return "issuer-mismatch";
    if (error.claim === "aud") return "audience-mismatch";
    return `claim-failed: ${error.claim}`;
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) return "bad-signature";
  if (error instanceof errors.JWKSNoMatchingKey) return "unknown-kid";
  if (error instanceof errors.JOSEError) return `jose: ${error.code}`;
  return `verify-error: ${error instanceof Error ? error.message : String(error)}`;
}

async function denialReason(
  assertion: string,
  config: { iss: string; aud: string },
): Promise<string | null> {
  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(assertion, jwksFor(config.iss), {
      issuer: config.iss,
      audience: config.aud,
      algorithms: ["RS256"],
    });
    payload = verified.payload;
  } catch (error) {
    return verifyDenial(error);
  }
  const commonName = payload.common_name;
  if (payload.sub !== "" || typeof commonName !== "string" || !commonName.endsWith(SERVICE_TOKEN_SUFFIX)) {
    return "not-a-service-token";
  }
  return null;
}

function assertionFromCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ASSERTION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

export async function accessPrecleared(request: Request, env: AccessPreclearanceEnv): Promise<boolean> {
  const iss = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  const assertion = request.headers.get(ASSERTION_HEADER) ?? assertionFromCookie(request.headers.get("cookie"));
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
