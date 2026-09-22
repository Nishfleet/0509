import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// J2 from docs/REBUILD-DONE.md §A: register a passkey on first sign-in, sign
// out, sign in with the passkey alone. The orchestrator's decision on 0509#3927
// accepts Playwright's CDP WebAuthn virtual authenticator as the honest J2 —
// it proves the app's WebAuthn wiring; the real-device proof stays a one-time
// manual record. The ceremony below is the same wire shape better-auth's
// passkey client produces: SimpleWebAuthn optionsJSON in, serialized
// PublicKeyCredential out, through the real /api/auth/passkey/* endpoints.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J2 proves the production mail path for its first sign-in; the local preview Worker can neither send nor receive email",
);

test("a passkey registered on first sign-in signs in on its own", async ({ page, context }) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

  await signInWithMagicLink(page, email, token);

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = (await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })) as { authenticatorId: string };

  try {
    const registration = await page.evaluate(async () => {
      const b64url = (buf: ArrayBuffer): string =>
        btoa(String.fromCharCode(...new Uint8Array(buf)))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "");
      const unb64url = (s: string): ArrayBuffer =>
        Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)).buffer;
      const report = (ok: boolean, step: string, status: number, body: string) => ({ ok, step, status, body });

      const optionsResponse = await fetch("/api/auth/passkey/generate-register-options");
      if (!optionsResponse.ok) {
        return report(false, "generate-register-options", optionsResponse.status, await optionsResponse.text());
      }
      const optionsJSON = await optionsResponse.json();
      const credential = (await navigator.credentials.create({
        publicKey: {
          ...optionsJSON,
          challenge: unb64url(optionsJSON.challenge),
          user: { ...optionsJSON.user, id: unb64url(optionsJSON.user.id) },
          excludeCredentials: (optionsJSON.excludeCredentials ?? []).map(
            (entry: { id: string }) => ({ ...entry, id: unb64url(entry.id) }),
          ),
        },
      })) as PublicKeyCredential | null;
      if (!credential) {
        return report(false, "navigator.credentials.create", 0, "returned null");
      }
      const attestation = credential.response as AuthenticatorAttestationResponse;
      const publicKey = attestation.getPublicKey?.() ?? undefined;
      const verify = await fetch("/api/auth/passkey/verify-registration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          response: {
            id: credential.id,
            rawId: b64url(credential.rawId),
            type: credential.type,
            authenticatorAttachment: credential.authenticatorAttachment ?? null,
            response: {
              attestationObject: b64url(attestation.attestationObject),
              clientDataJSON: b64url(attestation.clientDataJSON),
              transports: attestation.getTransports?.() ?? [],
              publicKeyAlgorithm: attestation.getPublicKeyAlgorithm?.(),
              publicKey: publicKey ? b64url(publicKey) : undefined,
              authenticatorData: attestation.getAuthenticatorData
                ? b64url(attestation.getAuthenticatorData())
                : undefined,
            },
          },
        }),
      });
      return report(verify.ok, "verify-registration", verify.status, await verify.text());
    });
    expect(registration.ok, `${registration.step} -> HTTP ${registration.status}: ${registration.body}`).toBe(true);

    const signOut = await page.evaluate(() =>
      fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).then((response) => response.status),
    );
    expect(signOut).toBe(200);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

    const authentication = await page.evaluate(async () => {
      const b64url = (buf: ArrayBuffer): string =>
        btoa(String.fromCharCode(...new Uint8Array(buf)))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "");
      const unb64url = (s: string): ArrayBuffer =>
        Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0)).buffer;
      const report = (ok: boolean, step: string, status: number, body: string) => ({ ok, step, status, body });

      const optionsResponse = await fetch("/api/auth/passkey/generate-authenticate-options");
      if (!optionsResponse.ok) {
        return report(false, "generate-authenticate-options", optionsResponse.status, await optionsResponse.text());
      }
      const optionsJSON = await optionsResponse.json();
      const credential = (await navigator.credentials.get({
        publicKey: {
          ...optionsJSON,
          challenge: unb64url(optionsJSON.challenge),
          allowCredentials: (optionsJSON.allowCredentials ?? []).map(
            (entry: { id: string }) => ({ ...entry, id: unb64url(entry.id) }),
          ),
        },
      })) as PublicKeyCredential | null;
      if (!credential) {
        return report(false, "navigator.credentials.get", 0, "returned null");
      }
      const assertion = credential.response as AuthenticatorAssertionResponse;
      const verify = await fetch("/api/auth/passkey/verify-authentication", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          response: {
            id: credential.id,
            rawId: b64url(credential.rawId),
            type: credential.type,
            authenticatorAttachment: credential.authenticatorAttachment ?? null,
            response: {
              authenticatorData: b64url(assertion.authenticatorData),
              clientDataJSON: b64url(assertion.clientDataJSON),
              signature: b64url(assertion.signature),
              userHandle: assertion.userHandle ? b64url(assertion.userHandle) : undefined,
            },
          },
        }),
      });
      return report(verify.ok, "verify-authentication", verify.status, await verify.text());
    });
    expect(authentication.ok, `${authentication.step} -> HTTP ${authentication.status}: ${authentication.body}`).toBe(true);

    await page.goto("/app");
    await expect(page.getByText(email)).toBeVisible();
    console.log(`passkey sign-in email=${email} sessionAt=${new Date().toISOString()}`);
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  }
});
