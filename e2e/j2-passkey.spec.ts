import { expect, test } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// J2 from docs/REBUILD-DONE.md §A: register a passkey on first sign-in, sign
// out, sign in with the passkey alone. The amended decision on 0509#3927
// accepts Playwright's CDP WebAuthn virtual authenticator as the honest J2 —
// it proves the app's WebAuthn wiring; the real-device proof stays a one-time
// manual record. The ceremony is driven through the real affordances from
// #3963 ("Add a passkey" on the signed-in page, "Sign in with a passkey" on /login): the
// authenticator answers at the browser layer, so the wire shape is whatever
// better-auth's client produces, not bytes this spec constructed.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J2 proves the production mail path for its first sign-in; the local preview Worker can neither send nor receive email",
);

test("a passkey registered on first sign-in signs in on its own", async ({ page, context }) => {
  test.setTimeout(150_000);
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
    // Register through the real button. The status region is the contract;
    // its copy is not asserted (smoke.spec.ts's contract-not-copy convention).
    await page.getByRole("button", { name: /passkey/i }).click();
    await expect(page.getByRole("status")).toBeVisible();

    // Sign out has no UI affordance yet; the session ends through better-auth's
    // real endpoint, and the /app -> /login redirect proves it ended.
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

    // The passkey alone: a resident credential on the virtual authenticator
    // answers the empty allowCredentials list the sign-in button produces.
    await page.getByRole("button", { name: /passkey/i }).click();
    // Measured 2026-09-22 against https://0509.io: 7.4s from this click to
    // /onboarding (verify-authentication, navigate("/app"), then the loader
    // redirect). The 5s expect default reports failure while that is in flight.
    // The test ceiling stays above the inbox poll (120s) so a missing message
    // still fails with the poll's own error.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 });
    await expect(page.getByText(email)).toBeVisible();
    console.log(`passkey sign-in email=${email} sessionAt=${new Date().toISOString()}`);
  } finally {
    // A teardown rejection must not mask the ceremony's own failure.
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);
  }
});
