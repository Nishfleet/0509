import { expect, test } from "./test";

import { consoleFailures, deleteCreatedAccount, requireInboxToken, signInWithMagicLink, watchConsole } from "./inbox";

let createdEmail = "";
test.afterEach(async ({ page }, testInfo) => {
  if (createdEmail === "") return;
  testInfo.setTimeout(testInfo.timeout + 60_000);

  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

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
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  try {
    const registered = page.waitForResponse((response) =>
      response.url().includes("/api/auth/passkey/verify-registration"),
    );
    await page.getByRole("button", { name: /passkey/i }).click();
    expect((await registered).status()).toBe(200);
    await expect(page.getByRole("status").filter({ hasText: /\S/ })).toBeVisible();

    await page.goto("/app/settings");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(/\/login/);
    await page.screenshot({ path: test.info().outputPath("signed-out.png") });
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);

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
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  try {
    const registered = page.waitForResponse((response) =>
      response.url().includes("/api/auth/passkey/verify-registration"),
    );

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
