import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { importPKCS8, SignJWT } from "jose";

import type { AppEnv } from "~/lib/env.server";
import { appOrigin } from "~/lib/env.server";
import { safeRedirectPath } from "~/lib/safe-redirect";
import type { AppSession } from "~/lib/types";
import {
  consumePasskeyChallenge,
  createPasskeyChallenge,
  getLivePasskeyChallenge,
  getPasskeyCredentialByCredentialId,
  getStytchIdentityForUser,
  insertPasskeyCredential,
  listPasskeyCredentialsForUser,
  storeStytchSession,
  updatePasskeyCredentialAfterAuthentication,
  upsertStytchAuthenticatedUser,
  type PasskeyCredentialRecord,
} from "~/lib/data.server";
import {
  attestTrustedAuthToken,
  isSameOriginAuthFormPost,
  isStytchConfigured,
  stytchSessionCookie,
} from "~/lib/stytch-b2b.server";

const PASSKEY_CHALLENGE_MAX_AGE_SECONDS = 10 * 60;
const DEFAULT_RP_NAME = "Five to Nine";

interface PasskeyRuntimeConfig {
  audience: string;
  issuer: string;
  privateKey: string;
  profileId: string;
}

export class PasskeyConfigurationError extends Error {
  constructor() {
    super("Passkeys are not configured.");
    this.name = "PasskeyConfigurationError";
  }
}

export class PasskeyVerificationError extends Error {
  constructor(message = "That passkey could not be verified.") {
    super(message);
    this.name = "PasskeyVerificationError";
  }
}

export function isPasskeyAuthConfigured(env: AppEnv) {
  return Boolean(
    isStytchConfigured(env) &&
      envFlagEnabled(env.STYTCH_B2B_PASSKEYS_ENABLED) &&
      env.STYTCH_TAT_PROFILE_ID?.trim() &&
      env.STYTCH_TAT_ISSUER?.trim() &&
      env.STYTCH_TAT_AUDIENCE?.trim() &&
      env.STYTCH_TAT_PRIVATE_KEY_B64?.trim(),
  );
}

export async function createPasskeyRegistrationOptions(
  env: AppEnv,
  request: Request,
  session: AppSession,
) {
  assertPasskeyPostAllowed(env, request);

  const identity = await getStytchIdentityForUser(env, session.user.id);
  if (!identity) {
    throw new PasskeyVerificationError("This account is not linked to Stytch.");
  }

  const existingCredentials = await listPasskeyCredentialsForUser(env, session.user.id);
  const rp = passkeyRelyingParty(env, request);
  const options = await generateRegistrationOptions({
    rpName: DEFAULT_RP_NAME,
    rpID: rp.rpID,
    userID: new TextEncoder().encode(session.user.id),
    userName: session.user.email,
    userDisplayName: session.user.name || session.user.email,
    attestationType: "none",
    excludeCredentials: existingCredentials.map((credential) => ({
      id: credential.credentialId,
      transports: credential.transports as AuthenticatorTransportFuture[],
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  const state = await createPasskeyChallenge(env, {
    kind: "registration",
    userId: session.user.id,
    challenge: options.challenge,
    maxAgeSeconds: PASSKEY_CHALLENGE_MAX_AGE_SECONDS,
  });

  return { options, state };
}

export async function verifyPasskeyRegistration(
  env: AppEnv,
  request: Request,
  session: AppSession,
  input: {
    credential: RegistrationResponseJSON;
    state: string;
  },
) {
  assertPasskeyPostAllowed(env, request);

  const challenge = await getLivePasskeyChallenge(env, {
    kind: "registration",
    state: input.state,
  });
  if (!challenge || challenge.userId !== session.user.id) {
    throw new PasskeyVerificationError();
  }

  const rp = passkeyRelyingParty(env, request);
  const verification = await verifyRegistrationResponse({
    response: input.credential,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new PasskeyVerificationError();
  }

  const identity = await getStytchIdentityForUser(env, session.user.id);
  if (!identity) {
    throw new PasskeyVerificationError("This account is not linked to Stytch.");
  }

  const { credential, credentialBackedUp, credentialDeviceType } =
    verification.registrationInfo;
  await insertPasskeyCredential(env, {
    userId: session.user.id,
    stytchOrganizationId: identity.stytchOrganizationId,
    stytchMemberId: identity.stytchMemberId,
    credentialId: credential.id,
    webauthnUserId: webauthnUserIdForUser(session.user.id),
    publicKey: bytesToBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    label: passkeyLabel(credential.transports ?? []),
  });
  await consumePasskeyChallenge(env, challenge.state);

  return { ok: true };
}

export async function createPasskeyAuthenticationOptions(
  env: AppEnv,
  request: Request,
  input: {
    redirectTo?: string | null;
  },
) {
  assertPasskeyPostAllowed(env, request);

  const rp = passkeyRelyingParty(env, request);
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    userVerification: "preferred",
  });
  const state = await createPasskeyChallenge(env, {
    kind: "authentication",
    challenge: options.challenge,
    redirectTo: safeRedirectPath(input.redirectTo, "/app"),
    maxAgeSeconds: PASSKEY_CHALLENGE_MAX_AGE_SECONDS,
  });

  return { options, state };
}

export async function verifyPasskeyAuthentication(
  env: AppEnv,
  request: Request,
  input: {
    credential: AuthenticationResponseJSON;
    state: string;
  },
) {
  assertPasskeyPostAllowed(env, request);

  const challenge = await getLivePasskeyChallenge(env, {
    kind: "authentication",
    state: input.state,
  });
  if (!challenge) {
    throw new PasskeyVerificationError();
  }

  const passkey = await getPasskeyCredentialByCredentialId(env, input.credential.id);
  if (!passkey) {
    throw new PasskeyVerificationError();
  }

  const rp = passkeyRelyingParty(env, request);
  const webauthnCredential: WebAuthnCredential = {
    id: passkey.credentialId,
    publicKey: base64UrlToBytes(passkey.publicKey),
    counter: passkey.counter,
    transports: passkey.transports as AuthenticatorTransportFuture[],
  };
  const verification = await verifyAuthenticationResponse({
    response: input.credential,
    expectedChallenge: challenge.challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: webauthnCredential,
  });

  if (!verification.verified) {
    throw new PasskeyVerificationError();
  }

  const jwt = await createTrustedAuthJwt(env, passkey);
  const stytchSession = await attestTrustedAuthToken(env, {
    organizationId: passkey.stytchOrganizationId,
    profileId: passkeyRuntimeConfig(env).profileId,
    token: jwt,
  });

  if (
    stytchSession.member_authenticated === false ||
    !stytchSession.session_token ||
    !stytchSession.member_session ||
    stytchSession.member.member_id !== passkey.stytchMemberId ||
    stytchSession.member.organization_id !== passkey.stytchOrganizationId
  ) {
    throw new PasskeyVerificationError("Stytch did not return a matching member session.");
  }

  const user = await upsertStytchAuthenticatedUser(env, {
    email: stytchSession.member.email_address || passkey.userEmail,
    name: stytchSession.member.name || passkey.userName,
    stytchMemberId: stytchSession.member.member_id,
    stytchOrganizationId: stytchSession.member.organization_id,
    stytchOrganizationName:
      stytchSession.organization?.organization_name || passkey.organizationName,
    stytchOrganizationSlug:
      stytchSession.organization?.organization_slug ?? passkey.organizationSlug,
  });
  await storeStytchSession(env, {
    sessionToken: stytchSession.session_token,
    userId: user.id,
    memberSessionId: stytchSession.member_session.member_session_id,
    expiresAt: stytchSession.member_session.expires_at,
  });
  await updatePasskeyCredentialAfterAuthentication(env, {
    credentialId: verification.authenticationInfo.credentialID,
    counter: verification.authenticationInfo.newCounter,
    deviceType: verification.authenticationInfo.credentialDeviceType,
    backedUp: verification.authenticationInfo.credentialBackedUp,
  });
  await consumePasskeyChallenge(env, challenge.state);

  return {
    headers: {
      "Set-Cookie": stytchSessionCookie(env, request, stytchSession.session_token),
    },
    redirectTo: safeRedirectPath(challenge.redirectTo, "/app"),
  };
}

export function publicPasskeyCredential(input: PasskeyCredentialRecord) {
  return {
    id: input.id,
    createdAt: input.createdAt,
    label: input.label || "Passkey",
    lastUsedAt: input.lastUsedAt,
  };
}

function assertPasskeyPostAllowed(env: AppEnv, request: Request) {
  if (!isPasskeyAuthConfigured(env)) {
    throw new PasskeyConfigurationError();
  }
  if (!isSameOriginAuthFormPost(env, request)) {
    throw new PasskeyVerificationError("That passkey request could not be verified.");
  }
}

function passkeyRuntimeConfig(env: AppEnv): PasskeyRuntimeConfig {
  const profileId = env.STYTCH_TAT_PROFILE_ID?.trim();
  const issuer = env.STYTCH_TAT_ISSUER?.trim();
  const audience = env.STYTCH_TAT_AUDIENCE?.trim();
  const privateKey = env.STYTCH_TAT_PRIVATE_KEY_B64?.trim();
  if (!profileId || !issuer || !audience || !privateKey) {
    throw new PasskeyConfigurationError();
  }
  return { audience, issuer, privateKey, profileId };
}

function passkeyRelyingParty(env: AppEnv, request: Request) {
  const origin = new URL(appOrigin(env, request)).origin;
  const configuredRpId = env.STYTCH_PASSKEY_RP_ID?.trim();
  return {
    origin,
    rpID: configuredRpId || new URL(origin).hostname,
  };
}

async function createTrustedAuthJwt(env: AppEnv, passkey: PasskeyCredentialRecord) {
  const config = passkeyRuntimeConfig(env);
  const privateKey = await importPKCS8(decodePrivateKey(config.privateKey), "RS256");
  const tokenId = `passkey:${passkey.id}:${crypto.randomUUID()}`;

  return new SignJWT({
    email: passkey.userEmail,
    organization_id: passkey.stytchOrganizationId,
    auth_factor: "passkey",
    passkey_credential_id: passkey.id,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(passkey.userId)
    .setJti(tokenId)
    .setExpirationTime("5m")
    .sign(privateKey);
}

function webauthnUserIdForUser(userId: string) {
  return bytesToBase64Url(new TextEncoder().encode(userId));
}

function passkeyLabel(transports: string[]) {
  if (transports.includes("internal")) {
    return "Device passkey";
  }
  if (transports.includes("hybrid")) {
    return "Synced passkey";
  }
  if (transports.length > 0) {
    return "Security key";
  }
  return "Passkey";
}

function decodePrivateKey(value: string) {
  const normalized = value.replace(/\\n/g, "\n").trim();
  if (normalized.includes("-----BEGIN")) {
    return normalized;
  }

  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes).trim();
}

function bytesToBase64Url(input: Uint8Array) {
  let binary = "";
  for (const byte of input) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input: string) {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function envFlagEnabled(value: string | undefined) {
  if (!value) {
    return false;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
