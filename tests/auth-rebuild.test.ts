import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const loginRoute = readFileSync("app/routes/auth.login.tsx", "utf8");
const signupRoute = readFileSync("app/routes/auth.signup.tsx", "utf8");
const apiAuthRoute = readFileSync("app/routes/api.auth.$.ts", "utf8");
const betterAuthServer = readFileSync("app/lib/better-auth.server.ts", "utf8");
const magicLinkRoute = readFileSync("app/routes/auth.better.magic-link.tsx", "utf8");
const authForm = readFileSync("app/components/auth-form.tsx", "utf8");
const authSurface = `${loginRoute}\n${signupRoute}\n${magicLinkRoute}\n${authForm}`;
const authClasses = Array.from(
  authSurface.matchAll(/className=(?:"([^"]+)"|{`([^`]+)`})/g),
).flatMap((match) =>
  (match[1] ?? match[2])
    .split(/\s+/)
    .map((className) => className.replace(/\$\{[^}]+\}/g, "").trim())
    .filter(Boolean),
);

describe("auth rebuild", () => {
  it("uses the fresh auth surface instead of the legacy auth system", () => {
    expect(authSurface).toContain('className="f9-auth-page"');
    expect(authClasses).not.toEqual(
      expect.arrayContaining([
        "auth-shell",
        "auth-grid",
        "auth-aside",
        "auth-card",
        "auth-copy",
        "auth-switch",
        "brand-mark",
        "brand-pill",
        "button-primary",
        "button-secondary",
        "stack-form",
        "field",
        "eyebrow",
        "bullet-list",
      ]),
    );
  });

  it("keeps stale launch framing out of auth", () => {
    expect(authSurface).not.toMatch(/pilot|beta|manual|fit review|self-serve|not live/i);
  });

  it("uses the Five to Nine wordmark in auth", () => {
    expect(authSurface).toContain("<BrandWordmark />");
  });

  it("keeps auth provider tokens out of rendered auth HTML", () => {
    expect(authSurface).not.toContain('name="token"');
    expect(authSurface).not.toContain('value={token}');
    expect(magicLinkRoute).not.toContain("hasBetterAuthMagicLinkRequestState");
    expect(magicLinkRoute).toContain("readBetterAuthMagicLinkConfirmationTicket");
    expect(magicLinkRoute).toContain("readBetterAuthMagicLinkVerificationTicket");
    expect(magicLinkRoute).toContain("consumeBetterAuthMagicLinkConfirmationTicket");
    expect(magicLinkRoute).toContain("betterAuthMagicLinkConfirmationTicketCookie");
    expect(magicLinkRoute).not.toContain("browserBound");
    expect(magicLinkRoute).not.toContain('name="token"');
    expect(apiAuthRoute).toContain("getBetterAuth");
    expect(apiAuthRoute).toContain("/api/auth/magic-link/verify");
    expect(apiAuthRoute).toContain("/api/auth/sign-in/magic-link");
    expect(betterAuthServer).toContain("verifyBetterAuthMagicLink");
    expect(betterAuthServer).toContain("/auth/better/magic-link");
    expect(betterAuthServer).toContain("better_auth_magic_link_ticket");
  });

  it("keeps OAuth login sign-in-only unless signup explicitly requests account creation", () => {
    expect(betterAuthServer).toContain("encryptOAuthTokens: true");
    expect(betterAuthServer).toContain("BETTER_AUTH_OAUTH_BRANDED_PROVIDERS");
    expect(betterAuthServer).toContain("BETTER_AUTH_MICROSOFT_ACCOUNT_LINKING_TRUSTED");
    expect(betterAuthServer).toContain("trustedProviders");
    expect(betterAuthServer.match(/disableImplicitSignUp:\s*true/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(betterAuthServer).toContain('requestSignUp: input.mode === "signup"');
    expect(
      betterAuthServer.match(
        /newUserCallbackURL:\s*input\.mode === "signup" \? callbackURL : undefined/g,
      ),
    ).toHaveLength(2);
  });

  it("requires discoverable passkeys for username-less passkey login", () => {
    expect(betterAuthServer).toContain('residentKey: "required"');
    expect(betterAuthServer).toContain("requireResidentKey: true");
  });
});
