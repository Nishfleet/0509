import { expect, test } from "@playwright/test";

import { consoleFailures, deleteCreatedAccount, requireInboxToken, signInWithMagicLink, watchConsole } from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);
  // The delete failing is a test failure, not a reason to keep the address:
  // clearing in finally means the next test in this worker cannot try to
  // delete an account that is already gone.
  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

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

test("a passkey registered on first sign-in signs in on its own @own-signin", async ({ page, context }, testInfo) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;

  await signInWithMagicLink(page, email, token);
  await page.goto("/app/settings");

  const watched = watchConsole(page);

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
    expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
    console.log(`passkey sign-in email=${email} sessionAt=${new Date().toISOString()}`);
  } finally {
    // A teardown rejection must not mask the ceremony's own failure.
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);
  }
});

test("a registered passkey is listed in Settings and can be removed @own-signin", async ({
  page,
  context,
}, testInfo) => {
  const token = requireInboxToken();
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;

  await signInWithMagicLink(page, email, token);
  await page.goto("/app/settings");

  const watched = watchConsole(page);

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
    const registered = page.waitForResponse((response) =>
      response.url().includes("/api/auth/passkey/verify-registration"),
    );
    // The new passkey must appear in the list without a full-page reload, and
    // the in-place revalidation must re-run the Settings loader (GET
    // /app/settings.data). A reload would miss the heading and then pass; a
    // client-side navigate() would also pass, so require the single-fetch
    // request react-router issues for it.
    const fullReloads: string[] = [];
    const loaderRevalidations: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.isNavigationRequest()) fullReloads.push(request.url());
      if (!request.isNavigationRequest() && url.pathname === "/app/settings.data") {
        loaderRevalidations.push(request.url());
      }
    });
    await page.getByRole("button", { name: /add a passkey/i }).click();
    expect((await registered).status()).toBe(200);

    await expect(page.getByRole("heading", { name: "Your passkeys" })).toBeVisible();
    expect(fullReloads, `unexpected reload: ${fullReloads.join(", ")}`).toEqual([]);
    expect(loaderRevalidations.length, "Settings loader did not re-run").toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath("passkey-listed.png") });

    await page.getByRole("button", { name: /^Remove /i }).click();
    await expect(page.getByText("Remove this passkey?")).toBeVisible();
    await page.getByRole("button", { name: /^Yes, remove /i }).click();

    await expect(page.getByRole("heading", { name: "Your passkeys" })).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Your passkeys" })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("passkey-removed.png") });
    expect(await consoleFailures(page, watched, testInfo), testInfo.project.name).toEqual([]);
    console.log(`passkey list+remove email=${email} at=${new Date().toISOString()}`);
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => undefined);
  }
});
