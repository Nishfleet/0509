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
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;

  await signInWithMagicLink(page, email, token);

  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

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
    // Any status matches, so a non-200 fails the expect with that status
    // instead of waiting out the test for a response that already arrived.
    const registered = page.waitForResponse((response) =>
      response.url().includes("/api/auth/passkey/verify-registration"),
    );
    await page.getByRole("button", { name: /passkey/i }).click();
    expect((await registered).status()).toBe(200);
    await expect(page.getByRole("status")).toBeVisible();

    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(/\/login/);
    await page.screenshot({ path: test.info().outputPath("signed-out.png") });
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

    // The passkey alone: a resident credential on the virtual authenticator
    // answers the empty allowCredentials list the sign-in button produces.
    // J1 checks /onboarding after the magic-link response. This checks it
    // after verify-authentication.
    const sessionReady = page.waitForResponse((response) =>
      response.url().includes("/api/auth/passkey/verify-authentication"),
    );
    await page.getByRole("button", { name: /passkey/i }).click();
    expect((await sessionReady).status()).toBe(200);
    await expect(page).toHaveURL(/\/onboarding/);
    await expect(page.getByText(email)).toBeVisible();
    expect(errors).toEqual([]);
    console.log(`passkey sign-in email=${email} sessionAt=${new Date().toISOString()}`);
  } finally {
    // A teardown rejection must not mask the ceremony's own failure.
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);
  }
});
