import { expect, test, type Page } from "@playwright/test";

import { requireInboxToken, signInWithMagicLink } from "./inbox";

// J2 from docs/REBUILD-DONE.md §A: register a passkey on first sign-in, sign
// out, sign in with the passkey alone. The amended decision on 0509#3927
// accepts Playwright's CDP WebAuthn virtual authenticator as the honest J2 —
// it proves the app's WebAuthn wiring; the real-device proof stays a one-time
// manual record. The ceremony is driven through the real affordances ("Add a
// passkey" on the signed-in page, "Sign in with a passkey" on /login): the
// authenticator answers at the browser layer, so the wire shape is whatever
// better-auth's client produces, not bytes this spec constructed.
//
// Where the register affordance lives (0509#3996): screen 1 is "one input,
// nothing else on screen" (DESIGN.md §2.3, REBUILD-ONBOARDING.md step 2), so
// the "Add a passkey" control cannot sit there any more. A fresh session lands
// on screen 1, whose one action posts to /onboarding and redirects to
// /onboarding/identity — so the register affordance lives on that screen, and
// J2 drives the real button there. When #3993 turns the identity landing into
// the card, this spec's reach moves with the affordance, unchanged.
test.skip(
  !process.env.PLAYWRIGHT_TEST_BASE_URL,
  "J2 proves the production mail path for its first sign-in; the local preview Worker can neither send nor receive email",
);

async function registerAffordance(page: Page) {
  // Screen 1's one action lands on /onboarding/identity, which carries "Add a
  // passkey" (0509#3996) so J2's register ceremony has a reachable home.
  await page.getByRole("textbox", { name: /website, or a handle/i }).fill("loopwell.com");
  await page.getByRole("button", { name: /continue/i }).click();
  await expect(page).toHaveURL(/\/onboarding\/identity\?input=loopwell\.com$/);
  return page.getByRole("button", { name: /passkey/i });
}

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
    // Register through the real button. The status region is the contract;
    // its copy is not asserted (smoke.spec.ts's contract-not-copy convention).
    await registerAffordance(page).click();
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
    await expect(page).toHaveURL(/\/onboarding/);
    // Screen 1 is "one input, nothing else on screen" (0509#3996), so the
    // session's address is no longer rendered here; the landing and the focus
    // are the session proof, exactly as J1 asserts them.
    await expect(page.getByRole("textbox", { name: /website, or a handle/i })).toBeFocused();
    console.log(`passkey sign-in email=${email} sessionAt=${new Date().toISOString()}`);
  } finally {
    // A teardown rejection must not mask the ceremony's own failure.
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);
  }
});
